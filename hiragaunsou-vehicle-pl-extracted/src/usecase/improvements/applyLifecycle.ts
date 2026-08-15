import type {
  ImprovementDetail,
  ImprovementRepository,
  ImprovementAuditEntry,
} from "../../domain/repositories/ImprovementRepository";
import type { InstructionTokenRepository } from "../../domain/repositories/InstructionTokenRepository";
import {
  lifecycleActionLabel,
  purgedNoteOf,
  shouldWithdrawInstruction,
  statusAfter,
  withdrawalNoteOf,
  type LifecycleAction,
} from "../../domain/rules/improvementLifecycle";
import { improvementStatusLabel } from "../../domain/rules/improvement";

/**
 * 改善要望の状態を変える・廃棄する・完全に削除する処理 (1件でも一括でも同じ道を通る)。
 *
 * 一括の途中で失敗しても、そこまでに成功した分は確定させる。全部やり直しにすると、
 * 50件のうち49件が終わっていても最初からになり、実務では使えない。
 * 失敗した行だけを画面に残して、そこだけやり直せるようにする。
 *
 * 直さないと決めたもの (見送り・誤作成・重複・廃棄) は、発行済みの指示文も取り下げる。
 * 管理画面では消したつもりなのに、Claude Code からはまだ読める、という状態を残さない。
 */

export interface LifecycleDeps {
  repo: ImprovementRepository;
  /** 完全削除のときに、その要望を読める鍵を止めるために使う。 */
  tokens: InstructionTokenRepository;
  actorId: string;
  actorName: string;
}

export interface LifecyclePlanItem {
  id: string;
  screenLabel: string;
  kind: "apply" | "skip";
  /** skip のときの理由、apply のときは「何が起きるか」。 */
  note: string;
  /** この操作に伴って指示文を取り下げるか。 */
  withdrawsInstruction: boolean;
}

export interface LifecycleRowResult extends LifecyclePlanItem {
  ok: boolean;
  message: string;
}

export interface LifecycleReport {
  dryRun: boolean;
  action: LifecycleAction;
  counts: { apply: number; skip: number; missing: number; withdraw: number };
  items: LifecyclePlanItem[];
  results: LifecycleRowResult[];
  /** 実行前に見せる内訳の文章。確認ダイアログにそのまま出す。 */
  summary: string;
  /** 完全削除で止めた鍵の名前。何を止めたかを画面に出すために返す。 */
  revokedTokens: string[];
}

export interface LifecycleInput {
  action: LifecycleAction;
  ids: string[];
  reason: string | null;
  duplicateOfId: string | null;
  dryRun: boolean;
}

/** その行に操作を当てても何も変わらないなら、その理由。変わるなら null。 */
function skipReason(action: LifecycleAction, row: ImprovementDetail): string | null {
  if (action === "restore") {
    return row.archivedAt === null ? "廃棄されていないため、戻す必要がありません" : null;
  }
  if (action === "archive") {
    return row.archivedAt !== null ? "すでに廃棄済みです" : null;
  }
  // 見送り・誤作成・重複は、すでに同じ状態でも止めない。理由やまとめ先を
  // 書き直したい場面があり、「変わらないから何もしない」と扱うと直せなくなる。
  return null;
}

/** いま指示文が読める状態か (取り下げる意味があるか)。 */
function instructionIsLive(row: ImprovementDetail): boolean {
  const i = row.instruction;
  return i !== null && i.state !== "withdrawn";
}

export async function applyLifecycle(
  input: LifecycleInput,
  deps: LifecycleDeps,
): Promise<LifecycleReport> {
  const rows = await deps.repo.findManyByIds(input.ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = input.ids.filter((id) => !byId.has(id)).length;

  // 「重複」のまとめ先。取り下げの記録に載せて、どこへ集約したのかを追えるようにする。
  let parentLabel: string | null = null;
  if (input.action === "duplicate" && input.duplicateOfId) {
    const parent = await deps.repo.findById(input.duplicateOfId);
    parentLabel = parent ? `${parent.screenLabel}（${parent.id}）` : null;
  }

  const nextStatus = statusAfter(input.action);
  const archived = input.action === "archive";

  const items: LifecyclePlanItem[] = [];
  for (const id of input.ids) {
    const row = byId.get(id);
    if (!row) continue;
    const skip = skipReason(input.action, row);
    if (skip !== null) {
      items.push({
        id,
        screenLabel: row.screenLabel,
        kind: "skip",
        note: skip,
        withdrawsInstruction: false,
      });
      continue;
    }
    const withdraws =
      instructionIsLive(row) &&
      (input.action === "purge" ||
        shouldWithdrawInstruction(nextStatus ?? row.status, archived || row.archivedAt !== null));
    items.push({
      id,
      screenLabel: row.screenLabel,
      kind: "apply",
      note: noteOf(input.action, row),
      withdrawsInstruction: withdraws,
    });
  }

  const counts = {
    apply: items.filter((i) => i.kind === "apply").length,
    skip: items.filter((i) => i.kind === "skip").length,
    missing,
    withdraw: items.filter((i) => i.withdrawsInstruction).length,
  };
  const summary = summaryOf(input.action, counts);

  if (input.dryRun) {
    return {
      dryRun: true,
      action: input.action,
      counts,
      items,
      results: [],
      summary,
      revokedTokens: [],
    };
  }

  const results: LifecycleRowResult[] = [];
  const purgeTargets: string[] = [];
  const audits: ImprovementAuditEntry[] = [];

  for (const item of items) {
    if (item.kind === "skip") {
      results.push({ ...item, ok: true, message: item.note });
      continue;
    }
    const row = byId.get(item.id);
    if (!row) continue;

    try {
      if (input.action === "purge") {
        // 記録は消す前に書く。消してから書くと、途中で落ちたときに
        // 「消えているのに誰が消したか分からない」という一番困る状態が残る。
        audits.push({
          requestId: row.id,
          actorId: deps.actorId,
          actorName: deps.actorName,
          action: "purge",
          fromStatus: row.status,
          toStatus: null,
          reason: purgedNoteOf({ actorName: deps.actorName, reason: input.reason }),
        });
        purgeTargets.push(row.id);
        results.push({ ...item, ok: true, message: "完全に削除しました。" });
        continue;
      }

      await deps.repo.updateLifecycle(row.id, {
        ...(nextStatus !== null ? { status: nextStatus } : {}),
        ...(input.reason !== null ? { note: input.reason } : {}),
        ...(input.action === "duplicate" ? { duplicateOfId: input.duplicateOfId } : {}),
        ...(input.action === "archive" ? { archivedAt: new Date() } : {}),
        ...(input.action === "restore" ? { archivedAt: null } : {}),
        actorId: deps.actorId,
      });

      audits.push({
        requestId: row.id,
        actorId: deps.actorId,
        actorName: deps.actorName,
        action:
          input.action === "archive"
            ? "archive"
            : input.action === "restore"
              ? "restore"
              : "status_change",
        fromStatus: row.status,
        toStatus: nextStatus ?? row.status,
        reason: input.reason,
      });

      let message = `${lifecycleActionLabel(input.action)}ました。`;
      if (item.withdrawsInstruction) {
        const note = withdrawalNoteOf({
          status: nextStatus ?? row.status,
          archived: archived || row.archivedAt !== null,
          reason: input.reason,
          parentLabel,
          actorName: deps.actorName,
        });
        await deps.repo.withdrawInstruction(row.id);
        message = `${message} 発行済みの指示文を取り下げました（Claude Code からは読めなくなります）。`;
        audits.push({
          requestId: row.id,
          actorId: deps.actorId,
          actorName: deps.actorName,
          action: "instruction_withdraw",
          fromStatus: null,
          toStatus: null,
          reason: note,
        });
      }
      results.push({ ...item, ok: true, message });
    } catch (e) {
      results.push({
        ...item,
        ok: false,
        message:
          e instanceof Error ? e.message : "この行だけ失敗しました。もう一度実行してください。",
      });
    }
  }

  // 記録を先に確定させてから本体を消す。順番を逆にすると、消えた後に記録が書けず、
  // 「誰にも説明できない削除」が残る。
  if (audits.length > 0) await deps.repo.appendAudit(audits);

  let revokedTokens: string[] = [];
  if (purgeTargets.length > 0) {
    // 鍵を先に止めてから消す。逆にすると、消えた直後の一瞬だけ生きた鍵が残り、
    // その間に読まれても記録の側では説明がつかない。
    revokedTokens = await deps.tokens.revokeForRequests(
      purgeTargets,
      "対象の改善要望が完全に削除されたため",
    );
    if (revokedTokens.length > 0) {
      await deps.repo.appendAudit(
        purgeTargets.map((id) => ({
          requestId: id,
          actorId: deps.actorId,
          actorName: deps.actorName,
          action: "token_revoke" as const,
          fromStatus: null,
          toStatus: null,
          reason: `完全削除にともない鍵を失効: ${revokedTokens.join(" / ")}`,
        })),
      );
    }
    await deps.repo.purge(purgeTargets);
  }

  return { dryRun: false, action: input.action, counts, items, results, summary, revokedTokens };
}

function noteOf(action: LifecycleAction, row: ImprovementDetail): string {
  if (action === "restore") return "廃棄から戻します";
  if (action === "archive") return "廃棄します（あとで戻せます）";
  if (action === "purge") {
    const parts = ["本文"];
    if (row.hasShot) parts.push("画面の写し");
    parts.push("診断情報");
    if (instructionIsLive(row)) parts.push("発行済みの指示文");
    return `${parts.join("・")}を消します（戻せません）`;
  }
  const next = statusAfter(action);
  return next !== null ? `「${improvementStatusLabel(next)}」にします` : "";
}

function summaryOf(
  action: LifecycleAction,
  counts: { apply: number; skip: number; missing: number; withdraw: number },
): string {
  const lines = [`${lifecycleActionLabel(action)}: ${counts.apply}件`];
  if (counts.skip > 0) lines.push(`何も変わらないため実行しない: ${counts.skip}件`);
  if (counts.missing > 0) lines.push(`見つからない（すでに消えている）: ${counts.missing}件`);
  if (counts.withdraw > 0) lines.push(`あわせて取り下げる指示文: ${counts.withdraw}件`);
  return lines.join(" / ");
}
