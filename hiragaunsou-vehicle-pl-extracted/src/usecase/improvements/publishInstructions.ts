import type {
  ImprovementDetail,
  ImprovementRepository,
} from "../../domain/repositories/ImprovementRepository";
import { buildInstruction, type Instruction } from "../../domain/rules/improvementInstruction";
import {
  changeSummaryText,
  instructionContentHash,
  parseSyncedFields,
  planInstructionSync,
  syncedFieldsOf,
  type InstructionSyncPlan,
  type InstructionSyncPlanItem,
} from "../../domain/rules/improvementInstructionSync";
import { signShotUrl } from "../../domain/rules/instructionAccess";

/**
 * 改善要望から Claude Code 向けの指示文を発行する処理。1件でも複数でも、必ずここを通る。
 *
 * 詳細画面の「Claude Code に渡す」と一覧の一括発行で処理を分けない。分けた時点で、
 * 片方にだけ入った守り (二重発行の防止・空更新の抑止・対象外の除外) が
 * もう片方から抜け、どちらを使ったかで結果が変わるようになる。
 *
 * 指示文の本文そのものは保存しない。保存するのは版と指紋だけで、読まれるたびに
 * そのときの管理画面の内容から組み立て直す。本文を持つと、要望を消したあとに
 * 写しだけが別の表に残る (消したはずのものが読める) 状態を作ってしまう。
 */

/** 発行の権利を持てる時間。組み立てにかかる時間より十分長く、詰まったままにはならない長さ。 */
export const PUBLISH_LEASE_MS = 60_000;

/** 画像を見せる期限。指示文を受け取った直後に読む前提で、短く切る。 */
export const SHOT_URL_TTL_MS = 24 * 60 * 60 * 1000;

export interface InstructionDeps {
  repo: ImprovementRepository;
  /** このアプリの入口 (指示文に載せる管理画面URL・画像URLの土台)。 */
  appOrigin: string;
  /** 画像の期限付きURLに署名する鍵。 */
  shotSecret: string;
  actorId: string;
  actorName: string;
}

export interface PublishOptions {
  dryRun: boolean;
}

export interface PublishResult extends InstructionSyncPlanItem {
  ok: boolean;
  /** 実行後に画面へ出す一言。失敗した理由もここに入れる (握り潰さない)。 */
  message: string;
  /**
   * ほかの発行と競合して見送った場合。
   * 内容の問題と分けるのは、こちらは「少し待てば通る」ものだから。
   */
  conflict?: boolean;
}

export interface PublishReport {
  plan: InstructionSyncPlan;
  /** 下書き。押す前に、外へ出る中身をそのまま読ませる。 */
  drafts: { id: string; title: string; markdown: string }[];
  results: PublishResult[];
}

interface Prepared {
  item: ImprovementDetail;
  instruction: Instruction;
  hash: string;
}

/**
 * 画像を見せるための、期限付きの署名URLを作る。
 *
 * ここで作るのは URL だけで、画像そのものはどこへも置かない
 * (置いた瞬間に、消す権限も期限もこちらの手を離れる)。
 */
export async function shotUrlFor(
  item: ImprovementDetail,
  deps: InstructionDeps,
  now: Date,
): Promise<string | null> {
  if (!item.hasShot || !deps.appOrigin) return null;
  const { exp, sig } = await signShotUrl(
    item.id,
    new Date(now.getTime() + SHOT_URL_TTL_MS),
    deps.shotSecret,
  );
  return `${deps.appOrigin}/api/instructions/shot/${item.id}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

/**
 * 内容が変わったかを見るための指紋。
 *
 * 版と画像URLを外して数える。版は出すたびに上がり、画像URLは期限を含むので
 * 呼ぶたびに変わる。そのまま数えると、中身が1文字も変わっていない要望まで
 * 毎回「更新あり」になり、空の更新が延々と積み上がる。
 */
export async function instructionHashOf(
  item: ImprovementDetail,
  deps: InstructionDeps,
): Promise<string> {
  const canonical = buildInstruction(item, {
    appOrigin: deps.appOrigin,
    shotUrl: item.hasShot ? "(画面の写し)" : null,
    version: 0,
  });
  return instructionContentHash(canonical);
}

/** 指示文を組み立てる (画面に見せる下書きと、比較用の指紋)。 */
export async function prepareInstruction(
  item: ImprovementDetail,
  deps: InstructionDeps,
  version: number,
  now: Date = new Date(),
): Promise<Prepared> {
  const shotUrl = await shotUrlFor(item, deps, now);
  const instruction = buildInstruction(item, { appOrigin: deps.appOrigin, shotUrl, version });
  return { item, instruction, hash: await instructionHashOf(item, deps) };
}

/**
 * 選ばれた件の指示文を発行する (dryRun なら計画と下書きだけ)。
 *
 * 呼び出し側が渡した順を守る。画面に並んでいる順と結果の順が違うと、
 * どの行が失敗したのかを目で追えない。
 */
export async function publishInstructions(
  ids: string[],
  deps: InstructionDeps,
  options: PublishOptions,
): Promise<PublishReport> {
  const found = await deps.repo.findManyByIds(ids);
  const byId = new Map(found.map((i) => [i.id, i]));
  const items = ids
    .map((id) => byId.get(id))
    .filter((i): i is ImprovementDetail => i !== undefined);

  const nextVersionOf = (item: ImprovementDetail) => (item.instruction?.version ?? 0) + 1;
  const prepared = await Promise.all(
    items.map((item) => prepareInstruction(item, deps, nextVersionOf(item))),
  );

  const plan = planInstructionSync(
    prepared.map((p) => ({
      id: p.item.id,
      screenLabel: p.item.screenLabel,
      status: p.item.status,
      archivedAt: p.item.archivedAt,
      instruction: p.item.instruction,
      nextHash: p.hash,
    })),
  );

  const drafts = prepared.map((p) => ({
    id: p.item.id,
    title: p.instruction.title,
    markdown: p.instruction.markdown,
  }));

  if (options.dryRun) return { plan, drafts, results: [] };

  const results: PublishResult[] = [];
  for (const planItem of plan.items) {
    const p = prepared.find((x) => x.item.id === planItem.id);
    if (!p) continue;
    if (planItem.kind === "excluded" || planItem.kind === "skip") {
      results.push({ ...planItem, ok: true, message: planItem.reason });
      continue;
    }
    results.push(await publishOne(p, planItem, deps));
  }

  // 実行したときも下書きを返す。失敗したときに「何を出そうとしたのか」が
  // 画面から読めないと、直しようがない。
  return { plan, drafts, results };
}

async function publishOne(
  p: Prepared,
  planItem: InstructionSyncPlanItem,
  deps: InstructionDeps,
): Promise<PublishResult> {
  const id = p.item.id;
  const claimed = await deps.repo.beginPublishing(id, PUBLISH_LEASE_MS);
  if (!claimed) {
    return {
      ...planItem,
      ok: false,
      conflict: true,
      message: "いま別の発行が動いています。少し待ってから、この行だけ出し直してください。",
    };
  }

  try {
    const before = parseSyncedFields(p.item.instruction?.syncedFields ?? null);
    const after = syncedFieldsOf(p.item);
    const saved = await deps.repo.markPublished(id, {
      version: planItem.version,
      hash: p.hash,
      syncedFields: JSON.stringify(after),
      publishedById: deps.actorId,
    });
    if (!saved) {
      await deps.repo.releasePublishing(id);
      return {
        ...planItem,
        ok: false,
        conflict: true,
        message: "先に別の発行が終わっていました。一覧を読み直してから、必要ならもう一度出してください。",
      };
    }

    await deps.repo.appendAudit([
      {
        requestId: id,
        actorId: deps.actorId,
        actorName: deps.actorName,
        action: planItem.kind === "publish" ? "instruction_publish" : "instruction_revise",
        fromStatus: before?.status ?? null,
        toStatus: after.status,
        reason:
          planItem.kind === "publish"
            ? `v${planItem.version} を発行`
            : `v${planItem.version} に更新\n${changeSummaryText(before, after, deps.actorName)}`,
      },
    ]);
    return {
      ...planItem,
      ok: true,
      message:
        planItem.kind === "publish"
          ? `指示文を発行しました（v${planItem.version}）。`
          : `指示文を最新に更新しました（v${planItem.version}）。`,
    };
  } catch (e) {
    await deps.repo.releasePublishing(id);
    return {
      ...planItem,
      ok: false,
      message: e instanceof Error ? e.message : "指示文を発行できませんでした。",
    };
  }
}
