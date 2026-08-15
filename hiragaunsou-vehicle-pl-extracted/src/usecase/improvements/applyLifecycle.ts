import type {
  ImprovementDetail,
  ImprovementRepository,
  ImprovementAuditEntry,
} from "../../domain/repositories/ImprovementRepository";
import type { GitHubIssueClient } from "../../infrastructure/github/GitHubIssueClient";
import {
  lifecycleActionLabel,
  shouldCloseIssue,
  statusAfter,
  type LifecycleAction,
} from "../../domain/rules/improvementLifecycle";
import { improvementStatusLabel } from "../../domain/rules/improvement";
import { closeIssueFor, notePurgedIssue } from "./syncIssues";

/**
 * 改善要望の状態を変える・廃棄する・完全に削除する処理 (1件でも一括でも同じ道を通る)。
 *
 * 一括の途中で失敗しても、そこまでに成功した分は確定させる。全部やり直しにすると、
 * 50件のうち49件が終わっていても最初からになり、実務では使えない。
 * 失敗した行だけを画面に残して、そこだけやり直せるようにする。
 */

export interface LifecycleDeps {
  repo: ImprovementRepository;
  client: GitHubIssueClient | null;
  actorId: string;
  actorName: string;
}

export interface LifecyclePlanItem {
  id: string;
  screenLabel: string;
  kind: "apply" | "skip";
  /** skip のときの理由、apply のときは「何が起きるか」。 */
  note: string;
  /** この操作に伴って閉じる Issue の番号 (閉じないなら null)。 */
  closingIssueNumber: number | null;
}

export interface LifecycleRowResult extends LifecyclePlanItem {
  ok: boolean;
  message: string;
}

export interface LifecycleReport {
  dryRun: boolean;
  action: LifecycleAction;
  counts: { apply: number; skip: number; missing: number; closeIssue: number };
  items: LifecyclePlanItem[];
  results: LifecycleRowResult[];
  /** 実行前に見せる内訳の文章。確認ダイアログにそのまま出す。 */
  summary: string;
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

export async function applyLifecycle(
  input: LifecycleInput,
  deps: LifecycleDeps,
): Promise<LifecycleReport> {
  const rows = await deps.repo.findManyByIds(input.ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = input.ids.filter((id) => !byId.has(id)).length;

  // 「重複」のまとめ先の Issue 番号。閉じるコメントに載せて、どこへ集約したのかを追えるようにする。
  let parentIssueNumber: number | null = null;
  if (input.action === "duplicate" && input.duplicateOfId) {
    const parent = await deps.repo.findById(input.duplicateOfId);
    parentIssueNumber = parent?.githubIssueNumber ?? null;
  }

  const nextStatus = statusAfter(input.action);
  const archived = input.action === "archive";

  const items: LifecyclePlanItem[] = [];
  for (const id of input.ids) {
    const row = byId.get(id);
    if (!row) continue;
    const skip = skipReason(input.action, row);
    if (skip !== null) {
      items.push({ id, screenLabel: row.screenLabel, kind: "skip", note: skip, closingIssueNumber: null });
      continue;
    }
    const closes =
      row.githubIssueNumber !== null &&
      row.githubIssueState !== "closed" &&
      (input.action === "purge" ||
        shouldCloseIssue(nextStatus ?? row.status, archived || row.archivedAt !== null));
    items.push({
      id,
      screenLabel: row.screenLabel,
      kind: "apply",
      note: noteOf(input.action, row),
      closingIssueNumber: closes ? row.githubIssueNumber : null,
    });
  }

  const counts = {
    apply: items.filter((i) => i.kind === "apply").length,
    skip: items.filter((i) => i.kind === "skip").length,
    missing,
    closeIssue: items.filter((i) => i.closingIssueNumber !== null).length,
  };
  const summary = summaryOf(input.action, counts);

  if (input.dryRun) {
    return { dryRun: true, action: input.action, counts, items, results: [], summary };
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
          reason: input.reason,
        });
        purgeTargets.push(row.id);
        if (item.closingIssueNumber !== null) {
          await notePurgedIssue(item.closingIssueNumber, input.reason, deps);
        }
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
          input.action === "archive" ? "archive" : input.action === "restore" ? "restore" : "status_change",
        fromStatus: row.status,
        toStatus: nextStatus ?? row.status,
        reason: input.reason,
      });

      let message = `${lifecycleActionLabel(input.action)}ました。`;
      if (item.closingIssueNumber !== null) {
        const closed = await closeIssueFor(
          {
            issueNumber: item.closingIssueNumber,
            status: nextStatus ?? row.status,
            archived: archived || row.archivedAt !== null,
            reason: input.reason,
            parentIssueNumber,
          },
          deps,
        );
        if (closed.closed) await deps.repo.markIssueState(row.id, "closed");
        message = `${message} ${closed.message}`;
        audits.push({
          requestId: row.id,
          actorId: deps.actorId,
          actorName: deps.actorName,
          action: "issue_close",
          fromStatus: null,
          toStatus: null,
          reason: closed.message,
        });
      }
      results.push({ ...item, ok: true, message });
    } catch (e) {
      results.push({
        ...item,
        ok: false,
        message: e instanceof Error ? e.message : "この行だけ失敗しました。もう一度実行してください。",
      });
    }
  }

  // 記録を先に確定させてから本体を消す。順番を逆にすると、消えた後に記録が書けず、
  // 「誰にも説明できない削除」が残る。
  if (audits.length > 0) await deps.repo.appendAudit(audits);
  if (purgeTargets.length > 0) await deps.repo.purge(purgeTargets);

  return { dryRun: false, action: input.action, counts, items, results, summary };
}

function noteOf(action: LifecycleAction, row: ImprovementDetail): string {
  if (action === "restore") return "廃棄から戻します";
  if (action === "archive") return "廃棄します（あとで戻せます）";
  if (action === "purge") {
    const parts = ["本文"];
    if (row.hasShot) parts.push("画面の写し");
    parts.push("診断情報");
    return `${parts.join("・")}を消します（戻せません）`;
  }
  const next = statusAfter(action);
  return next !== null ? `「${improvementStatusLabel(next)}」にします` : "";
}

function summaryOf(
  action: LifecycleAction,
  counts: { apply: number; skip: number; missing: number; closeIssue: number },
): string {
  const lines = [`${lifecycleActionLabel(action)}: ${counts.apply}件`];
  if (counts.skip > 0) lines.push(`何も変わらないため実行しない: ${counts.skip}件`);
  if (counts.missing > 0) lines.push(`見つからない（すでに消えている）: ${counts.missing}件`);
  if (counts.closeIssue > 0) lines.push(`あわせて閉じる GitHub Issue: ${counts.closeIssue}件`);
  return lines.join(" / ");
}
