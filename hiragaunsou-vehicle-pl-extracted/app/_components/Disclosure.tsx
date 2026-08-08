import type { ReactNode } from "react";

/**
 * 見出しを押すと本文が出る折りたたみ。
 *
 * ブラウザ標準の details/summary をそのまま使う(JSが動く前でも開ける・印刷で全部出る・
 * ページ内検索で中身が見つかる)。全画面で同じ見た目にするためだけの薄い包み。
 *
 * 引き出し(Drawer)との使い分け:
 *   - その場で読みながら操作を続ける説明 → こちら(折りたたみ)
 *   - 読み終わったら画面から消えてよい長い説明 → 引き出し
 */
export function Disclosure({
  summary,
  children,
  tone = "quiet",
}: {
  summary: string;
  children: ReactNode;
  /** quiet = 補足。inline = 入力欄のすぐ下に置く小さいもの */
  tone?: "quiet" | "inline";
}) {
  return (
    <details className={tone === "inline" ? "mt-2" : "mt-3 rounded-md border border-line bg-white"}>
      <summary
        className={
          tone === "inline"
            ? "cursor-pointer text-xs font-semibold text-brand-deep"
            : "cursor-pointer px-4 py-2.5 text-xs font-semibold text-brand-deep"
        }
      >
        {summary}
      </summary>
      <div
        className={
          tone === "inline"
            ? "mt-1.5 text-xs leading-relaxed text-ink-muted"
            : "border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-muted"
        }
      >
        {children}
      </div>
    </details>
  );
}
