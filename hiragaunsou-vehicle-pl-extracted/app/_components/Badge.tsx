import type { ReactNode } from "react";

/**
 * 状態・重大さを示す小さな札。
 *
 * これまで画面ごとに3種類以上の書き方があり、しかも重大さ3段階
 * (要修正・要確認・参考) が全部同じ色で塗られていて見分けられなかった。
 * 札の見た目は1箇所で決める。
 *
 * 色相は増やさない (docs/design-system.md §2)。使えるのは4つだけで、
 * 「目立たせたいから」ではなく「意味がこれだから」で選ぶ。
 *   danger  — 直さないと先へ進めないもの
 *   caution — 見て判断が要るもの
 *   brand   — 済んだもの・選ばれているもの
 *   neutral — 分類の名前 (良し悪しが無いもの)
 */
export type BadgeTone = "danger" | "caution" | "brand" | "neutral";

const TONE_CLASS: Record<BadgeTone, string> = {
  danger: "border-danger/40 bg-danger/10 text-danger",
  caution: "border-caution-border bg-caution-soft text-ink",
  brand: "border-brand/30 bg-brand-soft text-brand-deep",
  neutral: "border-line bg-subtle text-ink-muted",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        TONE_CLASS[tone],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
