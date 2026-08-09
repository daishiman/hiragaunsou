import type { ReactNode } from "react";

export type AlertTone = "danger" | "caution" | "success" | "info";

/**
 * 取込の結果(失敗・注意・完了)を出す共通パネル。
 *
 * これまで失敗は 12px 未満の赤い1行、成功も同じ大きさの1行で、取込に失敗しても
 * 「0台のまま何も起きていない画面」に見えていた。マスタ画面はどれも
 * 「ファイルを選ぶ → 結果を読む」の1本道なので、結果は本文と同じ大きさの面で出し、
 * 見落とせないようにする。
 *
 * 色は意味にだけ使う: 失敗=danger、注意=caution、完了と補足=brand。
 * 成功に緑を足すと1画面の色相が増えるため、完了は brand の面で表す。
 */
const TONE_CLASS: Record<AlertTone, string> = {
  danger: "border-danger/40 bg-danger/5",
  caution: "border-caution-border bg-caution-soft",
  success: "border-brand/30 bg-brand-soft",
  info: "border-line bg-subtle",
};

const TITLE_CLASS: Record<AlertTone, string> = {
  danger: "text-danger",
  caution: "text-ink",
  success: "text-brand-deep",
  info: "text-ink",
};

export function AlertPanel({
  tone,
  title,
  children,
}: {
  tone: AlertTone;
  title: string;
  /** 詳細(行ごとの理由・次にやること)。無ければ見出しだけ出す。 */
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${TONE_CLASS[tone]}`} role="status">
      <p className={`text-sm font-bold ${TITLE_CLASS[tone]}`}>{title}</p>
      {children ? (
        <div className="prose-note mt-1.5 text-xs leading-relaxed text-ink">{children}</div>
      ) : null}
    </div>
  );
}
