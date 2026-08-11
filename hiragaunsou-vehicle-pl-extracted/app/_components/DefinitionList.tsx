import type { ReactNode } from "react";

/**
 * 項目名と値を対にして並べる器。
 *
 * 表との使い分けは1つの質問で決まる (docs/product/T7-ui-conventions.md §4-1):
 *   「列をまたいで値を見比べたい」なら表、「1件を読んで判断したい」ならこちら。
 *
 * 1台の車両の詳細のように「対象が1件しかない」場面で表を使うと、
 * 見出し行が1行に対して中身も1行になり、目が横に長い1行を追うだけになる。
 * 項目名と値が縦に対になっていれば、上から読むだけで済む。
 *
 * かつて画面の中で <dt>/<dd> を <dl> に入れずに書いていた箇所があったが、
 * それでは読み上げに「これは項目名と値の組だ」と伝わらない。必ずこの部品を通す。
 */

export interface DefinitionItem {
  /** 項目名。業務の言葉で書く (用語は T7 §1 の表に従う) */
  term: string;
  /** 値。数字は .num を付けて渡す */
  value: ReactNode;
  /** 値の下に出す一言 (前月比・由来・注意)。無ければ省く */
  note?: ReactNode;
}

export function DefinitionList({
  items,
  /**
   * 1列で縦に積むか、広い画面で2列にするか。
   *   stack — 常に1列。項目が5つ以下、または値が長い場合
   *   split — 広い画面で2列。項目が多く、1つ1つが短い場合
   */
  layout = "stack",
  className,
}: {
  items: readonly DefinitionItem[];
  layout?: "stack" | "split";
  className?: string;
}) {
  return (
    <dl
      className={[
        layout === "split" ? "grid gap-x-8 sm:grid-cols-2" : "flex flex-col",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {items.map((item) => (
        <div
          key={item.term}
          className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-baseline gap-3 border-b border-line py-2 last:border-b-0 sm:last:border-b"
        >
          <dt className="text-xs text-ink-muted">{item.term}</dt>
          <dd className="text-sm text-ink">
            {item.value}
            {item.note ? <span className="mt-0.5 block text-[11px] text-ink-muted">{item.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
