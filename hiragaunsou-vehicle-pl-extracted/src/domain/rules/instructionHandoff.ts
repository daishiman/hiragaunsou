/**
 * 指示文を渡してから直り終わるまでの、状態の進み方。
 *
 *   未対応 ──(Claude Code が指示文を取得)──▶ 対応中
 *   対応中 ──(PR を作成)──────────────────▶ レビュー待ち
 *   レビュー待ち ──(PR をマージ)───────────▶ 対応済み
 *   レビュー待ち ──(PR を閉じた)───────────▶ 対応中
 *
 * 人が押して進めるのではなく、実際に起きたこと (取得・PR作成・マージ) を
 * そのまま状態にする。人が押す運用にすると、直ったのに未対応のまま残る件と、
 * 直していないのに対応済みになる件が同時に増え、一覧が信用できなくなる。
 *
 * 進めるのは1方向だけではない。PR を閉じたら対応中へ戻す。
 * 「レビュー待ちのまま誰も見ていない」状態を放置するより、
 * 手が空いていることが一覧から分かるほうがよい。
 */

import type { ImprovementStatus } from "./improvement";

/** 鍵から伝えてよい出来事。これ以外の状態変更は管理画面 (人) の仕事にする。 */
export const HANDOFF_EVENTS = ["fetched", "pr_opened", "pr_merged", "pr_closed"] as const;
export type HandoffEvent = (typeof HANDOFF_EVENTS)[number];

export function isHandoffEvent(value: string): value is HandoffEvent {
  return (HANDOFF_EVENTS as readonly string[]).includes(value);
}

const EVENT_LABEL: Record<HandoffEvent, string> = {
  fetched: "Claude Code が指示文を取得",
  pr_opened: "修正の確認依頼を作成",
  pr_merged: "修正を本番へ反映",
  pr_closed: "修正の確認依頼を取り下げ",
};

export function handoffEventLabel(event: HandoffEvent): string {
  return EVENT_LABEL[event];
}

export interface HandoffOutcome {
  /** 変えたあとの状態。変えないなら null。 */
  nextStatus: ImprovementStatus | null;
  /** 記録に残す一文。状態が動かなかったときも残す (何も起きなかったのではない)。 */
  reason: string;
  /** PR の控えをどうするか。undefined なら触らない。 */
  pr?: { url: string; number: number } | null;
}

/**
 * 出来事から、次の状態を決める。
 *
 * 見送り・誤作成・重複になっている件は動かさない。人が理由を書いて脇へ寄せた判断を、
 * 機械が黙って引き戻してはいけない。取り違えていたなら管理画面で戻す。
 */
export function applyHandoffEvent(
  current: ImprovementStatus,
  event: HandoffEvent,
  pr?: { url: string; number: number } | null,
): HandoffOutcome {
  const parked = current === "dropped" || current === "invalid" || current === "duplicate";
  if (parked) {
    return {
      nextStatus: null,
      reason: `${EVENT_LABEL[event]}。状態は「${current}」のままにしました（人が理由を書いて脇へ寄せた件のため）。`,
    };
  }

  switch (event) {
    case "fetched":
      // 既に対応中より先へ進んでいる件を、取り直しただけで巻き戻さない。
      // 直したあとに指示文をもう一度読むことはよくある。
      return current === "open"
        ? { nextStatus: "doing", reason: "Claude Code が指示文を取得したため「対応中」にしました。" }
        : { nextStatus: null, reason: "Claude Code が指示文を取得しました。" };
    case "pr_opened":
      return {
        nextStatus: "review",
        reason: `修正の確認依頼を作成したため「レビュー待ち」にしました。${prSuffix(pr)}`,
        pr: pr ?? null,
      };
    case "pr_merged":
      return {
        nextStatus: "done",
        reason: `修正を本番へ反映したため「対応済み」にしました。${prSuffix(pr)}`,
        pr: pr ?? undefined,
      };
    case "pr_closed":
      return {
        nextStatus: "doing",
        // 控えを消すのは、次に作る PR と取り違えないため。記録には理由が残る。
        reason: `修正の確認依頼が取り下げられたため「対応中」に戻しました。${prSuffix(pr)}`,
        pr: null,
      };
  }
}

function prSuffix(pr?: { url: string; number: number } | null): string {
  return pr ? `(#${pr.number} ${pr.url})` : "";
}

/**
 * PR の指し先として受け付けてよい URL か。
 *
 * 保存した URL は管理画面のリンクになる。任意の文字列を通すと、
 * 鍵を持つ相手が管理者の画面に好きな行き先のリンクを置けることになる。
 * GitHub の PR の形だけに絞り、番号も URL 側から読み直して食い違いを弾く。
 */
export function parsePrReference(url: unknown, number: unknown): { url: string; number: number } | null {
  if (typeof url !== "string") return null;
  const m = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)$/.exec(url.trim());
  if (!m) return null;
  const fromUrl = Number(m[1]);
  if (typeof number === "number" && Number.isFinite(number) && number !== fromUrl) return null;
  return { url: url.trim(), number: fromUrl };
}
