import type { ReactNode } from "react";

/**
 * 全画面共通の表。
 *
 * ■ なぜ共通部品にしたか
 * これまで18の画面がそれぞれ <table> を書き起こしていた。結果として
 * 見出しの色がある表と無い表、列が折り返す表と折り返さない表、狭い画面で
 * はみ出す表とはみ出さない表が混在していた。表は「値を見比べるための器」なので、
 * 器の作りが画面ごとに違うと比較の仕方まで画面ごとに変わってしまう。
 *
 * ■ 見出しの固定について (ここが要点)
 * 横スクロールできる箱 (overflow-x) を作った時点で、その箱がスクロールの担当になる。
 * すると中の position: sticky は「箱の内側のスクロール」だけを見るようになり、
 * ページを下へスクロールしても見出しは付いてこない。これが今まで
 * どの表でも見出しが固定できていなかった理由。
 *
 * 確実に固定するには、箱に高さの上限を与えて縦にもスクロールさせる。
 * maxHeight を渡したときだけ見出しが固定される。逆に言えば、
 * 数行しかない表に maxHeight を付ける必要はない (画面から消えないため)。
 * 判断の根拠は docs/product/T7-ui-conventions.md §2-1。
 *
 * ■ 狭い画面
 * 列に priority: "low" を付けると 640px 未満では隠れる。隠す列がある表には
 * 「狭い画面では ○○ を省いています」と必ず書く。黙って消すと、
 * 「スマホだと数字が合わない」という不具合報告になる (正直なUI)。
 */

export interface DataTableColumn<Row> {
  /** React の key と列の識別に使う */
  key: string;
  /** 列見出し。単位は unit に分けて書く */
  header: ReactNode;
  /** 単位 (km・円・件)。見出しの後ろに小さく付く。セルには単位を入れない */
  unit?: string;
  /** 数値の列は right。既定は left */
  align?: "left" | "right";
  /**
   * 狭い画面での優先度。
   *   high (既定) — いつでも出す
   *   low         — 640px 未満では隠す
   */
  priority?: "high" | "low";
  /** セルの中身 */
  cell: (row: Row, index: number) => ReactNode;
  /** セルに足すクラス。長い文を入れる列には "wrap" を付ける */
  cellClassName?: string;
  /** 見出しに足すクラス (幅の指定など) */
  headClassName?: string;
}

export interface DataTableProps<Row> {
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string;
  /**
   * 表の高さの上限 (CSS の長さ)。渡すと縦スクロールになり、列見出しが固定される。
   * 20行を超えうる表には必ず渡す。
   */
  maxHeight?: string;
  /** 行が0件のときに出すもの。理由と次の行き先を必ず書く */
  empty: ReactNode;
  /** 合計行など。tfoot に入る (固定しない。一番下にあることに意味があるため) */
  footer?: ReactNode;
  /** 行ごとの追加クラス (赤字の行を目立たせる等) */
  rowClassName?: (row: Row, index: number) => string | undefined;
  /** 表の説明。読み上げ用に必ず書く */
  caption: string;
  /** caption を目で見えるようにするか。既定は読み上げのみ */
  showCaption?: boolean;
  className?: string;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  maxHeight,
  empty,
  footer,
  rowClassName,
  caption,
  showCaption = false,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0) return <>{empty}</>;

  /** 隠す列の名前。見出しが文字のものだけを並べる (図形の見出しは名前で呼べないため) */
  const hiddenColumnNames = columns
    .filter((c) => c.priority === "low")
    .map((c) => (typeof c.header === "string" ? c.header : null))
    .filter((name): name is string => name !== null);
  const stickyHead = maxHeight !== undefined;

  return (
    <div>
      <div
        className={["overflow-auto", className].filter(Boolean).join(" ")}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="data-table min-w-full text-xs">
          <caption className={showCaption ? "pb-2 text-left text-xs text-ink-muted" : "sr-only"}>
            {caption}
          </caption>
          <thead className={stickyHead ? "sticky top-0 z-10" : undefined}>
            <tr className="border-b border-line bg-subtle text-left text-ink-muted">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={[
                    "px-3 py-2 font-semibold",
                    col.align === "right" ? "text-right" : "text-left",
                    col.priority === "low" ? "hidden sm:table-cell" : "",
                    col.headClassName ?? "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {col.header}
                  {col.unit ? (
                    <span className="ml-1 font-normal text-[10px]">（{col.unit}）</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className={[
                  "border-b border-line last:border-b-0",
                  rowClassName?.(row, index) ?? "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={[
                      "px-3 py-2",
                      col.align === "right" ? "num text-right" : "",
                      col.priority === "low" ? "hidden sm:table-cell" : "",
                      col.cellClassName ?? "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {col.cell(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>

      {hiddenColumnNames.length > 0 ? (
        <p className="mt-1.5 text-[11px] text-ink-muted sm:hidden">
          狭い画面では{hiddenColumnNames.join("・")}を省いています。
          横向きにするか、広い画面で開くと全部見えます。
        </p>
      ) : null}
    </div>
  );
}
