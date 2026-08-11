import type { ReactNode } from "react";

/**
 * 絞り込みの条件と件数を、画面の上に貼り付けておく帯。
 *
 * ■ なぜ要るか
 * 100台の表を下までスクロールすると、「これは何月の数字か」「いま何で絞っているか」
 * 「全部で何件のうち何件を見ているか」が画面から消えていた。数字だけが見えていて
 * 前提が見えない状態は、読み違いの原因になる。
 *
 * ■ どこに貼るか
 * ページのいちばん上にアプリのヘッダー、その下に工程の帯 (毎月の締めの画面だけ)、
 * さらにその下がこの帯という積み重ねになる (docs/product/T7-ui-conventions.md §2-2)。
 * 工程の帯がある画面では below="stepHeader" を渡す。
 *
 * ■ 貼らないもの
 * 画面の説明・補足の折りたたみは貼らない。貼るのは
 * 「見えないと、いま出ている数字の意味が分からなくなるもの」だけ。
 */
export function StickyFilterBar({
  /** 絞り込みの操作 (年月・検索・チップ)。左に置く */
  children,
  /** 件数など、いま何を見ているかを表す文字。右に置く */
  summary,
  /** 上に何があるか。工程の帯がある画面は stepHeader */
  below = "header",
  className,
}: {
  children: ReactNode;
  summary?: ReactNode;
  below?: "header" | "stepHeader";
  className?: string;
}) {
  return (
    <div
      className={[
        // 本文の左右の余白ぶん外へ広げて、帯が画面いっぱいに見えるようにする
        "sticky z-10 -mx-4 mb-4 flex min-h-[var(--screen-filter-bar-h)] items-center border-b border-line bg-white/95 px-4 py-2 backdrop-blur lg:-mx-8 lg:px-8",
        below === "stepHeader"
          ? "top-[calc(var(--app-header-h)+var(--screen-step-header-h))]"
          : "top-[var(--app-header-h)]",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">{children}</div>
        {summary ? (
          <p className="shrink-0 text-xs text-ink-muted">{summary}</p>
        ) : null}
      </div>
    </div>
  );
}
