import type { ImprovementDetail } from "../../domain/repositories/ImprovementRepository";
import type {
  InstructionTokenRecord,
  InstructionTokenRepository,
} from "../../domain/repositories/InstructionTokenRepository";
import {
  buildInstruction,
  type StructuredInstruction,
} from "../../domain/rules/improvementInstruction";
import { hashAccessToken, tokenAllows, tokenRejection } from "../../domain/rules/instructionAccess";
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

/** 鍵を確かめる。断る理由は日本語で返す (Claude Code の画面にそのまま出る)。 */
export async function authorizeToken(
  rawToken: string | null,
  tokens: InstructionTokenRepository,
  now: Date = new Date(),
): Promise<{ token: InstructionTokenRecord } | { error: string }> {
  if (!rawToken) {
    return { error: "鍵がありません。Authorization: Bearer <鍵> を付けて呼んでください。" };
  }
  const record = await tokens.findByHash(await hashAccessToken(rawToken));
  const rejection = tokenRejection(record, now);
  if (rejection !== null || !record) return { error: rejection ?? "この鍵は使えません。" };
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
    await deps.repo.appendAudit(
      fetched.map((id) => ({
        requestId: id,
        actorId: null,
        // 誰が読んだかは鍵の名前で残す。人ではなく鍵が読みに来るため。
        actorName: `鍵: ${token.name || token.id}`,
        action: "instruction_fetch" as const,
        fromStatus: null,
        toStatus: null,
        reason: "Claude Code が指示文を読み取りました。",
      })),
    );
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
