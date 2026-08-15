/**
 * 改善要望の一生 (見送り・誤作成・重複・廃棄・完全削除) の決まりごと。
 *
 * 状態の付け替えと削除は、押し間違いの取り返しがつくかどうかで性質がまるで違う。
 * ここでは次の2つを分けて扱う。
 *   1. 戻せるもの … 状態変更・廃棄 (archive)。既定の「削除」はこちら
 *   2. 戻せないもの … 完全削除 (purge)。最上位の管理者だけ・二段階の確認・監査を残す
 *
 * 「削除」と書かれたボタンが戻せない操作を指していると、いつか必ず消したくないものが消える。
 * だから既定を廃棄にし、完全削除は別の操作として名前も導線も分ける。
 *
 * このアプリは平賀運送1社だけを扱う (会社テーブルを持たない)。したがって
 * 「他社のレコードを触らせない」という境界はデータの側に存在せず、代わりに
 * 「読み書きできるのは manage_improvements を持つ管理者だけ」を境界とする。
 * 完全削除はさらに上の admin 専用に絞る (accessControl 側で判定する)。
 */

import {
  improvementStatusLabel,
  requiresReason,
  type ImprovementStatus,
} from "./improvement";

/* ───────────────────────── 操作 ───────────────────────── */

export const LIFECYCLE_ACTIONS = [
  "drop",
  "invalid",
  "duplicate",
  "archive",
  "restore",
  "purge",
] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export function isLifecycleAction(value: string): value is LifecycleAction {
  return (LIFECYCLE_ACTIONS as readonly string[]).includes(value);
}

const ACTION_LABEL: Record<LifecycleAction, string> = {
  drop: "見送りにする",
  invalid: "誤作成にする",
  duplicate: "重複にする",
  archive: "廃棄する（戻せます）",
  restore: "廃棄から戻す",
  purge: "完全に削除する（戻せません）",
};

export function lifecycleActionLabel(action: LifecycleAction): string {
  return ACTION_LABEL[action];
}

/** その操作が行き着く状態。廃棄・復元・完全削除は状態を変えない。 */
export function statusAfter(action: LifecycleAction): ImprovementStatus | null {
  if (action === "drop") return "dropped";
  if (action === "invalid") return "invalid";
  if (action === "duplicate") return "duplicate";
  return null;
}

/** 理由の入力が要る操作か。理由の無い「誤作成」は、後から見た人には判断のやり直しができない。 */
export function actionRequiresReason(action: LifecycleAction): boolean {
  const next = statusAfter(action);
  return next !== null ? requiresReason(next) : action === "purge";
}

/* ───────────────────────── 一括操作の受け入れ ───────────────────────── */

/**
 * 1回の一括操作で扱える件数の上限。
 *
 * 上限を置くのは、GitHub への通信が件数分だけ並ぶため。1リクエストの中で
 * いくらでも投げられる作りにすると、途中で Worker の実行時間や GitHub の
 * 制限に当たり、どこまで進んだか分からない終わり方をする。
 * 超えた分は黙って切り捨てず、画面に「上限を超えています」と出して選び直させる。
 */
export const LIFECYCLE_BULK_MAX = 50;

/** 1回の一括起票で扱える件数の上限。GitHub への通信を伴うので、状態変更より厳しくする。 */
export const ISSUE_BULK_MAX = 25;

export interface LifecycleRequest {
  action: LifecycleAction;
  ids: string[];
  reason?: string | null;
  /** 「重複」のときの親 (どの要望と同じ話か)。 */
  duplicateOfId?: string | null;
  /** 完全削除のときに画面が数えた件数。ids と一致しなければ実行しない。 */
  confirmCount?: number | null;
}

/**
 * 一括操作を受け付けてよいか。受け付けられない理由を日本語で返す (問題なければ null)。
 *
 * 完全削除だけ件数の一致まで見るのは、画面で見えていた件数と実際に消える件数が
 * ずれたまま実行されるのを止めるため (選択したあとに誰かが増やした・減らした場合)。
 */
export function lifecycleRequestError(req: LifecycleRequest): string | null {
  if (req.ids.length === 0) return "対象が選ばれていません。";
  if (req.ids.length > LIFECYCLE_BULK_MAX) {
    return `一度に扱えるのは${LIFECYCLE_BULK_MAX}件までです（いま${req.ids.length}件が選ばれています）。分けて実行してください。`;
  }
  if (new Set(req.ids).size !== req.ids.length) return "同じ要望が重複して選ばれています。";

  const reason = req.reason?.trim() ?? "";
  if (actionRequiresReason(req.action) && reason.length === 0) {
    return `${lifecycleActionLabel(req.action)}ときの理由を入力してください。`;
  }

  if (req.action === "duplicate") {
    const parent = req.duplicateOfId?.trim() ?? "";
    if (!parent) return "どの要望と重複しているかを選んでください。";
    if (req.ids.includes(parent)) return "重複のまとめ先に、選んだ要望そのものは指定できません。";
  }

  if (req.action === "purge") {
    if (req.confirmCount !== req.ids.length) {
      return "削除する件数が画面の表示と一致しません。もう一度選び直してください。";
    }
  }

  return null;
}

/* ───────────────────────── 起票の対象か ───────────────────────── */

export interface IssueEligibility {
  status: ImprovementStatus;
  archivedAt: Date | null;
}

/**
 * 一括起票の対象から外す理由 (対象なら null)。
 *
 * 見送り・誤作成・重複・廃棄は「直さないと決めたもの」なので、選ばれていても送らない。
 * 選択から黙って消すのではなく、内訳に「対象外 K件」として理由つきで出す
 * (黙って減らすと、送ったつもりの件が届いていないことに気づけない)。
 */
export function issueExclusionReason(row: IssueEligibility): string | null {
  if (row.archivedAt != null) return "廃棄済みのため送りません";
  if (row.status === "dropped") return "見送りのため送りません";
  if (row.status === "invalid") return "誤作成のため送りません";
  if (row.status === "duplicate") return "重複のため送りません";
  return null;
}

/** 状態を変えたときに、既に立っている Issue を閉じるべきか。 */
export function shouldCloseIssue(status: ImprovementStatus, archived: boolean): boolean {
  return archived || status === "dropped" || status === "invalid" || status === "duplicate";
}

/** Issue を閉じるときに添える一言。なぜ閉じたのかが Issue だけで分かるようにする。 */
export function closingCommentOf(input: {
  status: ImprovementStatus;
  archived: boolean;
  reason: string | null;
  parentIssueNumber: number | null;
  actorName: string;
}): string {
  const head = input.archived
    ? "この改善要望は管理画面で廃棄されました。"
    : `この改善要望は管理画面で「${improvementStatusLabel(input.status)}」になりました。`;
  const lines = [head, ""];
  if (input.status === "duplicate") {
    lines.push(
      input.parentIssueNumber !== null
        ? `まとめ先: #${input.parentIssueNumber}`
        : "まとめ先の要望はまだ Issue になっていません。",
      "",
    );
  }
  const reason = input.reason?.trim();
  if (reason) lines.push("理由:", "", `> ${reason.replace(/\n/g, "\n> ")}`, "");
  lines.push(`操作した人: ${input.actorName || "管理者"}`);
  lines.push("", "この Issue は自動で閉じられました。作業を続ける場合は開き直してください。");
  return lines.join("\n");
}

/**
 * 元データを完全削除したときに Issue へ残す一言。
 *
 * Issue そのものは消さない。GitHub の Issue は通知も履歴も残り、消しても取り消しにならないため、
 * 「無かったこと」にはできない。代わりに、元を見に行っても無いことをその場に書き残す。
 */
export function purgedCommentOf(input: { actorName: string; reason: string | null }): string {
  const lines = [
    "この Issue のもとになった改善要望は、管理画面で完全に削除されました。",
    "",
    "- 本文・画面の写し・送信時の記録は残っていません。",
    "- 上に載っている管理画面へのリンクは開いても見つかりません。",
    "",
  ];
  const reason = input.reason?.trim();
  if (reason) lines.push("理由:", "", `> ${reason.replace(/\n/g, "\n> ")}`, "");
  lines.push(`操作した人: ${input.actorName || "管理者"}`);
  return lines.join("\n");
}
