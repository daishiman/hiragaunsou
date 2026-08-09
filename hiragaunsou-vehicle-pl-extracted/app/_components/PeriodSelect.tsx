import Link from "next/link";
import { yearMonthLabel } from "../_lib/format";

/**
 * 期間の絞り込み。プリセット1タップを主経路にし、任意期間は開いた人だけが使う。
 *
 * 月を2つ選ばせるのは「決めることが2つある」ので、最頻の見方 (直近3/6/12ヶ月・今月) を
 * 1タップのプリセットに畳む。GETフォームなのでJSなしで動き、URLがそのまま共有できる。
 */
export interface PeriodPreset {
  label: string;
  from: string;
  to: string;
}

export interface PeriodSelectProps {
  basePath: string;
  from: string;
  to: string;
  presets: readonly PeriodPreset[];
  /** 選択肢に出す年月 (新しい→古い順) */
  options: readonly string[];
}

export function PeriodSelect({ basePath, from, to, presets, options }: PeriodSelectProps) {
  const activeIndex = presets.findIndex((p) => p.from === from && p.to === to);

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="期間のプリセット">
        {presets.map((p, i) => (
          <Link
            key={p.label}
            href={`${basePath}?from=${p.from}&to=${p.to}`}
            aria-current={i === activeIndex ? "true" : undefined}
            className={[
              "pressable rounded-md border px-2 py-1.5 text-center text-xs font-semibold",
              i === activeIndex
                ? "border-brand bg-brand-soft text-brand-deep"
                : "border-line bg-white text-ink hover:bg-subtle",
            ].join(" ")}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <details className="group">
        <summary className="cursor-pointer list-none text-right text-[11px] text-ink-muted hover:text-brand-deep">
          期間を指定する
        </summary>
        <form action={basePath} method="get" className="mt-2 flex items-center gap-1.5">
          <label className="sr-only" htmlFor="period-from">
            開始月
          </label>
          <select
            id="period-from"
            name="from"
            defaultValue={from}
            className="num rounded-md border border-line bg-white px-2 py-1.5 text-xs"
          >
            {options.map((ym) => (
              <option key={ym} value={ym}>
                {yearMonthLabel(ym)}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-muted">〜</span>
          <label className="sr-only" htmlFor="period-to">
            終了月
          </label>
          <select
            id="period-to"
            name="to"
            defaultValue={to}
            className="num rounded-md border border-line bg-white px-2 py-1.5 text-xs"
          >
            {options.map((ym) => (
              <option key={ym} value={ym}>
                {yearMonthLabel(ym)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn btn-secondary btn-sm pressable"
          >
            表示する
          </button>
        </form>
      </details>
    </div>
  );
}
