import type { ImprovementDetail } from "../../domain/repositories/ImprovementRepository";
import type {
  InstructionTokenRecord,
  InstructionTokenRepository,
} from "../../domain/repositories/InstructionTokenRepository";
import {
  buildInstruction,
  type StructuredInstruction,
} from "../../domain/rules/improvementInstruction";
import {
  hashAccessToken,
  readRejection,
  tokenActorName,
  tokenAllows,
  tokenRejection,
} from "../../domain/rules/instructionAccess";
import { applyHandoffEvent } from "../../domain/rules/instructionHandoff";
import { type InstructionDeps, shotUrlFor } from "./publishInstructions";

/**
 * Claude Code が指示文を読みに来たときの処理。
 *
 * 守りはここ1箇所に集める。1件取得と一括取得で判定を書き分けると、
 * 片方にだけ入った確認 (鍵の期限・範囲・発行済みかどうか) がもう片方から抜ける。
 *
 * 読ませてよいのは「発行済みの指示文がある要望」だけ。管理画面に載っていても、
 * まだ渡すと決めていないものが鍵1本で全部読めてしまってはいけない。
 */

export interface ReadDeps extends InstructionDeps {
  tokens: InstructionTokenRepository;
}

export interface AuthorizedToken {
  record: InstructionTokenRecord;
}

/**
 * 鍵を確かめる。断る理由は日本語で返す (Claude Code の画面にそのまま出る)。
 *
 * need で「この口に必要な力」を指定する。read だけ持つ鍵で状態を変えに来た場合も、
 * status:any だけ持つ鍵で指示文を読みに来た場合も、ここで止まる。
 * 力の確認を口ごとに書き分けないのは、片方にだけ入った確認がもう片方から抜けるため。
 */
export async function authorizeToken(
  rawToken: string | null,
  tokens: InstructionTokenRepository,
  now: Date = new Date(),
  need: "read" | "none" = "read",
): Promise<{ token: InstructionTokenRecord } | { error: string }> {
  if (!rawToken) {
    return { error: "鍵がありません。Authorization: Bearer <鍵> を付けて呼んでください。" };
  }
  const record = await tokens.findByHash(await hashAccessToken(rawToken));
  const rejection = tokenRejection(record, now);
  if (rejection !== null || !record) return { error: rejection ?? "この鍵は使えません。" };
  if (need === "read") {
    const denied = readRejection(record);
    if (denied) return { error: denied };
  }
  return { token: record };
}

export interface InstructionPayload {
  id: string;
  title: string;
  markdown: string;
  structured: StructuredInstruction;
  version: number;
}

/**
 * 鍵で読める指示文をまとめて取り出す。
 *
 * 読めた件は「取込済み」にし、いつ・どの鍵で読まれたかを記録に残す。
 * 記録が無いと、鍵が外へ出たときに何が読まれたのかを後から数えられない。
 */
export async function readInstructions(
  ids: string[],
  token: InstructionTokenRecord,
  deps: ReadDeps,
  now: Date = new Date(),
): Promise<{ items: InstructionPayload[]; skipped: { id: string; reason: string }[] }> {
  const allowed = ids.filter((id) => tokenAllows(token, id));
  const denied = ids
    .filter((id) => !tokenAllows(token, id))
    .map((id) => ({ id, reason: "この鍵では読めません。" }));

  const rows = await deps.repo.findManyByIds(allowed);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const items: InstructionPayload[] = [];
  const skipped = [...denied];
  const fetched: string[] = [];

  for (const id of allowed) {
    const row = byId.get(id);
    if (!row) {
      skipped.push({ id, reason: "この要望は見つかりません（削除された可能性があります）。" });
      continue;
    }
    const instruction = row.instruction;
    if (!instruction || instruction.state === "withdrawn" || instruction.publishedAt === null) {
      skipped.push({ id, reason: "この要望の指示文は発行されていません。" });
      continue;
    }
    items.push(await payloadOf(row, deps, instruction.version, now));
    fetched.push(id);
  }

  if (fetched.length > 0) {
    await deps.repo.markFetched(fetched);

    // 読み取ったことを鍵に紐づけて控える。「自分が取得した要望だけ状態を進められる」の
    // 根拠になる記録なので、指示文を返す前ではなく返す確定後にまとめて書く。
    await deps.tokens.recordClaims(token.id, fetched);

    // 取りに来た時点で「対応中」にする。取得と着手のあいだに人の操作を挟むと、
    // 直している最中の件が一覧では未対応のまま残り、二重に着手される。
    const actorName = tokenActorName(token);
    const audit: Parameters<typeof deps.repo.appendAudit>[0] = [];
    for (const id of fetched) {
      const before = byId.get(id)?.status;
      const outcome = before ? applyHandoffEvent(before, "fetched") : null;
      if (outcome?.nextStatus) {
        await deps.repo.recordHandoff(id, { status: outcome.nextStatus });
      }
      audit.push({
        requestId: id,
        actorId: null,
        // 誰が読んだかは鍵の名前で残す。人ではなく鍵が読みに来るため。
        actorName,
        action: "instruction_fetch" as const,
        fromStatus: before ?? null,
        toStatus: outcome?.nextStatus ?? null,
        reason: outcome?.reason ?? "Claude Code が指示文を読み取りました。",
      });
    }
    await deps.repo.appendAudit(audit);
    await deps.tokens.touch(token.id);
  }

  // 優先度の高い順に並べる。まとめて渡したとき、どれから直せばよいかが
  // 読み手の判断ではなく、こちらの並びで伝わるようにする。
  const rank = { 高: 0, 中: 1, 低: 2 } as const;
  items.sort(
    (a, b) => rank[a.structured.priority] - rank[b.structured.priority],
  );
  return { items, skipped };
}

async function payloadOf(
  row: ImprovementDetail,
  deps: ReadDeps,
  version: number,
  now: Date,
): Promise<InstructionPayload> {
  const shotUrl = await shotUrlFor(row, deps, now);
  const built = buildInstruction(row, { appOrigin: deps.appOrigin, shotUrl, version });
  return {
    id: row.id,
    title: built.title,
    markdown: built.markdown,
    structured: built.structured,
    version,
  };
}

/** 複数件を1つの文書にまとめる。件ごとに区切り、優先度が分かる順に並べる。 */
export function combineMarkdown(items: InstructionPayload[]): string {
  if (items.length === 0) {
    return [
      "# 渡された改善要望はありません",
      "",
      "指示文が1件も発行されていないか、この鍵では読めない件だけが指定されています。",
      "管理画面の改善要望一覧で「Claude Code に渡す」を実行してから、もう一度試してください。",
    ].join("\n");
  }

  const head = [
    `# 改善要望 ${items.length}件（優先度の高い順）`,
    "",
    "以下は平賀運送 車両別収支アプリの利用者から届いた改善要望です。",
    "1件ずつ順に直してください。件ごとに「受け入れ条件」があります。すべて満たしてから次へ進んでください。",
    "",
    "## 直す順番",
    "",
    ...items.map(
      (item, index) =>
        `${index + 1}. [優先度 ${item.structured.priority}／${item.structured.kind}] ${item.title}`,
    ),
    "",
  ].join("\n");

  const bodies = items.map(
    (item, index) => `${"─".repeat(60)}\n\n## ${index + 1}件目 / ${items.length}件\n\n${item.markdown}`,
  );
  return [head, ...bodies].join("\n\n");
}
