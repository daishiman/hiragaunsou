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
 * 数字の根拠 (2026-08-15 実測):
 * - 組み立ての計算量は制約にならない。50件で 0.8ms、Worker の CPU 上限には遠い。
 * - D1 の「1文あたりバインド100個」も制約にならない。超える文は分割して流している
 *   (D1ImprovementRepository の AUDIT_COLUMNS / chunkIdsForD1)。
 * - 効いてくるのは応答の大きさと、人が一度に読み切れる量。指示文は1件あたり
 *   約2,700文字あり、50件で約137,000文字になる。これ以上まとめても読み手が追えない。
 *
 * 超えた分は黙って切り捨てず、画面に「上限を超えています」と出して選び直させる。
 */
export const LIFECYCLE_BULK_MAX = 50;

/**
 * 1回の一括発行で扱える件数の上限。
 *
 * 状態変更より厳しくするのは、発行の結果が「Claude Code に渡す1つの文書」になるため。
 * 25件で約69,000文字。ここを増やすと、渡した相手が最初の数件で手一杯になり、
 * 後ろの件が読まれないまま「渡したのに直っていない」状態になる。
 */
export const PUBLISH_BULK_MAX = 25;

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

/* ───────────────────────── 指示文を渡す対象か ───────────────────────── */

export interface PublishEligibility {
  status: ImprovementStatus;
  archivedAt: Date | null;
}

/**
 * 一括発行の対象から外す理由 (対象なら null)。
 *
 * 見送り・誤作成・重複・廃棄は「直さないと決めたもの」なので、選ばれていても渡さない。
 * 選択から黙って消すのではなく、内訳に「対象外 K件」として理由つきで出す
 * (黙って減らすと、渡したつもりの件が渡っていないことに気づけない)。
 */
export function publishExclusionReason(row: PublishEligibility): string | null {
  if (row.archivedAt != null) return "廃棄済みのため渡しません";
  if (row.status === "dropped") return "見送りのため渡しません";
  if (row.status === "invalid") return "誤作成のため渡しません";
  if (row.status === "duplicate") return "重複のため渡しません";
  return null;
}

/**
 * 状態を変えたときに、発行済みの指示文を取り下げるべきか。
 *
 * 取り下げると、Claude Code からは読めなくなる (取り込み済みでも次は届かない)。
 * 直さないと決めたものを、外から読める場所に残し続けないため。
 */
export function shouldWithdrawInstruction(status: ImprovementStatus, archived: boolean): boolean {
  return archived || status === "dropped" || status === "invalid" || status === "duplicate";
}

/**
 * 指示文を取り下げるときに残す一言。
 *
 * 記録 (監査) と管理画面に出る。なぜ読めなくなったのかが、後から見た人に分かるようにする。
 */
export function withdrawalNoteOf(input: {
  status: ImprovementStatus;
  archived: boolean;
  reason: string | null;
  parentLabel: string | null;
  actorName: string;
}): string {
  const head = input.archived
    ? "廃棄されたため、指示文を取り下げました。"
    : `「${improvementStatusLabel(input.status)}」になったため、指示文を取り下げました。`;
  const lines = [head];
  if (input.status === "duplicate") {
    lines.push(
      input.parentLabel !== null
        ? `まとめ先: ${input.parentLabel}`
        : "まとめ先の要望は、まだ指示文を発行していません。",
    );
  }
  const reason = input.reason?.trim();
  if (reason) lines.push(`理由: ${reason.replace(/\n/g, " ")}`);
  lines.push(`操作した人: ${input.actorName || "管理者"}`);
  lines.push("状態を戻しても、指示文は自動では出し直しません（もう一度渡す操作が要ります）。");
  return lines.join("\n");
}

/**
 * 完全削除したときに記録へ残す一言。
 *
 * 指示文はこのアプリの中にしか無いので、元データと一緒に消える。
 * 消えたことと、その鍵が使えなくなることを、記録の側に書き残す。
 */
export function purgedNoteOf(input: { actorName: string; reason: string | null }): string {
  const lines = [
    "本文・画面の写し・送信時の記録・発行済みの指示文を、まとめて完全に削除しました。",
    "この要望を読むために配ってあった鍵も、あわせて失効させました。",
  ];
  const reason = input.reason?.trim();
  if (reason) lines.push(`理由: ${reason.replace(/\n/g, " ")}`);
  lines.push(`操作した人: ${input.actorName || "管理者"}`);
  return lines.join("\n");
}
