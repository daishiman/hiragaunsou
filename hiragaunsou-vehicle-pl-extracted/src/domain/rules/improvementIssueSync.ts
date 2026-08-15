/**
 * 一括で Issue に送るときの「何をするか」の決め方。
 *
 * ここは通信をしない。何件を新しく立てて、何件を更新して、何件は何もしないかを
 * 先に全部決めてから、初めて GitHub へ投げる。押す前に内訳を見せるためであり、
 * 「押してみないと何が起きるか分からない」操作にしないため。
 *
 * 冪等であることが一番の関心。同じものを2回押しても、同時に押しても、
 * 通信が切れて再送されても、Issue が増えないこと。そのために次の3段で守る。
 *   1. ここ (計画) … 既に番号があるものは create にしない
 *   2. 保存 (repository) … 番号が入っていない行だけを更新する条件付き UPDATE
 *   3. DB … github_issue_number の一意索引
 * 1だけでは、同時に走った2つの計画が両方 create になる。3だけでは、
 * 先に GitHub へ2本立ってから片方が捨てられる。3段そろって初めて増えない。
 */

import type { IssueDraft } from "./improvementIssue";
import { improvementStatusLabel, type ImprovementStatus } from "./improvement";
import { issueExclusionReason } from "./improvementLifecycle";

/* ───────────────────────── 内容の指紋 ───────────────────────── */

/**
 * Issue に載せる内容の指紋。前回と同じなら GitHub へ何も投げない。
 *
 * 中身そのものを保存して比べる手もあるが、要望1件あたり数十KBになり、
 * 比較のためだけに DB が倍になる。変わったかどうかだけ分かればよいので指紋にする。
 */
export async function issueContentHash(draft: IssueDraft): Promise<string> {
  const source = `${draft.title}\n\n${draft.body}\n\n${[...draft.labels].sort().join(",")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}

/* ───────────────────────── Issue へ送った時点の控え ───────────────────────── */

/**
 * Issue へ最後に送った時点の値。次に送るとき、何が変わったかをコメントに書くために持つ。
 * 指紋だけでは「変わった」ことしか分からない。
 */
export interface SyncedFields {
  status: ImprovementStatus;
  handledNote: string | null;
  screenLabel: string;
  /** 廃棄されているか。廃棄で閉じたあと戻したときに差分として出す。 */
  archived: boolean;
}

export function syncedFieldsOf(input: {
  status: ImprovementStatus;
  handledNote: string | null;
  screenLabel: string;
  archivedAt: Date | null;
}): SyncedFields {
  return {
    status: input.status,
    handledNote: input.handledNote,
    screenLabel: input.screenLabel,
    archived: input.archivedAt != null,
  };
}

export function parseSyncedFields(raw: string | null): SyncedFields | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SyncedFields>;
    if (typeof v.status !== "string" || typeof v.screenLabel !== "string") return null;
    return {
      status: v.status as ImprovementStatus,
      handledNote: typeof v.handledNote === "string" ? v.handledNote : null,
      screenLabel: v.screenLabel,
      archived: v.archived === true,
    };
  } catch {
    return null;
  }
}

/**
 * 前回と今回の差を、そのまま Issue のコメントにできる形にする。
 *
 * 本文を上書きするだけだと、開いた人は最新を読めるが「何が変わったのか」が消える。
 * コメントだけだと、最新を読むのに履歴を全部たどることになる。だから両方やる。
 */
export function changeSummaryComment(
  before: SyncedFields | null,
  after: SyncedFields,
  actorName: string,
): string {
  const changes: string[] = [];
  if (!before) {
    changes.push("- 管理画面の内容に合わせて本文を更新しました。");
  } else {
    if (before.status !== after.status) {
      changes.push(
        `- 状況: ${improvementStatusLabel(before.status)} → **${improvementStatusLabel(after.status)}**`,
      );
    }
    if ((before.handledNote ?? "") !== (after.handledNote ?? "")) {
      const next = after.handledNote?.trim();
      changes.push(next ? `- 対応メモ: ${next}` : "- 対応メモ: （消しました）");
    }
    if (before.archived !== after.archived) {
      changes.push(after.archived ? "- 廃棄しました" : "- 廃棄から戻しました");
    }
    if (before.screenLabel !== after.screenLabel) {
      changes.push(`- 画面: ${before.screenLabel} → ${after.screenLabel}`);
    }
    if (changes.length === 0) changes.push("- 本文を最新の内容に更新しました。");
  }
  return [
    "管理画面の内容が変わったので、本文を最新に置き換えました。",
    "",
    ...changes,
    "",
    `更新した人: ${actorName || "管理者"}`,
  ].join("\n");
}

/* ───────────────────────── 何をするかの計画 ───────────────────────── */

export type IssueSyncKind = "create" | "update" | "skip" | "excluded";

export interface IssueSyncInput {
  id: string;
  screenLabel: string;
  status: ImprovementStatus;
  archivedAt: Date | null;
  githubIssueNumber: number | null;
  /** 最後に確かめた GitHub 側の状態。"missing" は消された・見つからないもの。 */
  githubIssueState: string | null;
  /** 前回 Issue へ送った内容の指紋。 */
  storedHash: string | null;
  /** 今回送る内容の指紋。 */
  nextHash: string;
}

export interface IssueSyncPlanItem {
  id: string;
  screenLabel: string;
  kind: IssueSyncKind;
  issueNumber: number | null;
  /** その扱いになった理由。画面にそのまま出す。 */
  reason: string;
}

export interface IssueSyncPlan {
  items: IssueSyncPlanItem[];
  create: number;
  update: number;
  skip: number;
  excluded: number;
}

/**
 * 選ばれた件を、新規作成 / 更新 / 何もしない / 対象外 に振り分ける。
 *
 * GitHub 側で Issue が消えていた場合 (missing) は、未起票として扱って新しく立て直す。
 * 消えた番号を持ち続けると、以後この要望は永久に更新も作成もできなくなる。
 */
export function planIssueSync(rows: IssueSyncInput[]): IssueSyncPlan {
  const items = rows.map((row): IssueSyncPlanItem => {
    const excluded = issueExclusionReason(row);
    if (excluded) {
      return {
        id: row.id,
        screenLabel: row.screenLabel,
        kind: "excluded",
        issueNumber: row.githubIssueNumber,
        reason: excluded,
      };
    }
    if (row.githubIssueNumber === null) {
      return {
        id: row.id,
        screenLabel: row.screenLabel,
        kind: "create",
        issueNumber: null,
        reason: "新しく Issue を立てます",
      };
    }
    if (row.githubIssueState === "missing") {
      return {
        id: row.id,
        screenLabel: row.screenLabel,
        kind: "create",
        issueNumber: null,
        reason: `Issue #${row.githubIssueNumber} が見つからないため、立て直します`,
      };
    }
    if (row.storedHash !== null && row.storedHash === row.nextHash) {
      return {
        id: row.id,
        screenLabel: row.screenLabel,
        kind: "skip",
        issueNumber: row.githubIssueNumber,
        reason: `Issue #${row.githubIssueNumber} から内容が変わっていません`,
      };
    }
    return {
      id: row.id,
      screenLabel: row.screenLabel,
      kind: "update",
      issueNumber: row.githubIssueNumber,
      reason: `Issue #${row.githubIssueNumber} を最新の内容に更新します`,
    };
  });

  return {
    items,
    create: items.filter((i) => i.kind === "create").length,
    update: items.filter((i) => i.kind === "update").length,
    skip: items.filter((i) => i.kind === "skip").length,
    excluded: items.filter((i) => i.kind === "excluded").length,
  };
}

/** 確認ダイアログに出す一言。押す前に何が起きるかが1行で分かるようにする。 */
export function planSummaryText(plan: IssueSyncPlan): string {
  const parts = [
    `新規作成 ${plan.create}件`,
    `既存を更新 ${plan.update}件`,
    `変更なしのため送らない ${plan.skip}件`,
  ];
  if (plan.excluded > 0) parts.push(`対象外 ${plan.excluded}件`);
  return parts.join(" / ");
}
