import { man, pct } from "../../_lib/format";

/**
 * 構成比・実数比較の横棒 (ラベル + バー + 値の3列)。
 *
 * バーを描いてよい条件 (jp-web-design §9) のうち「構成比 (合計100%)」と
 * 「同一単位の実数比較 (0起点・最大値を基準に固定)」だけに使う。
 * 単色 (brand または danger) で、識別は色ではなくラベルと数値が担う。
 */
export interface ShareBarItem {
  /** 行の見出し (科目名・車番など) */
  label: string;
  /** 補助情報 (所属・運転者など)。無ければ省略。 */
  sub?: string;
  value: number;
  /** 構成比 (0〜1)。null なら比率を表示しない。 */
  share?: number | null;
  href?: string;
}

export interface ShareBarsProps {
  items: readonly ShareBarItem[];
  /** danger = 赤字系の並び / brand = 通常 */
  tone?: "brand" | "danger";
  /** 値の表示に使う単位ラベル (既定は金額) */
  formatValue?: (value: number) => string;
}

export function ShareBars({ items, tone = "brand", formatValue = man }: ShareBarsProps) {
  if (items.length === 0) return null;
  // 0起点・データ中の最大絶対値を100%とする(基準の違う棒を並べない)
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  const barColor = tone === "danger" ? "bg-danger" : "bg-brand";

  return (
    <ul className="grid gap-1.5">
      {items.map((item) => {
        const width = (Math.abs(item.value) / max) * 100;
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[13px] text-ink">
                {item.label}
                {item.sub && <span className="ml-1.5 text-[11px] text-ink-muted">{item.sub}</span>}
              </span>
              <span className="num shrink-0 text-[13px] font-bold text-ink">
                {formatValue(item.value)}
                {item.share != null && (
                  <span className="ml-1.5 text-[11px] font-normal text-ink-muted">
                    {pct(item.share)}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
              <div
                className={`h-full rounded-full ${barColor}`}
                style={{ width: `${Math.max(width, 1)}%` }}
              />
            </div>
          </>
        );

        return (
          <li key={item.label}>
            {item.href ? (
              <a
                href={item.href}
                className="block rounded-md px-2 py-1.5 hover:bg-subtle focus-visible:bg-subtle"
              >
                {body}
              </a>
            ) : (
              <div className="px-2 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
