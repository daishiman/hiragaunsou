import Link from "next/link";
import { pct } from "../_lib/format";

/**
 * KPIタイル。「大きく1つの数字 + 脇に補助情報」の型を全画面で統一する。
 *
 * 値/ラベル/単位の描き分け (jp-web-design §3-2):
 * 濃く太い数字 = 変わる値 / 12px muted = 固定ラベル / 単位は値の6割サイズ。
 * 状態は色だけで伝えず、必ず文字ラベル (「前年比」「うち赤字」) を伴わせる。
 */
export interface StatTileProps {
  label: string;
  /** 主数字 (整形済み文字列)。単位は unit に分ける。 */
  value: string;
  unit?: string;
  /** 対前年などの増減率。null なら「比較なし」を表示する。 */
  diff?: number | null;
  /** diff のラベル (既定「前年比」) */
  diffLabel?: string;
  /** 主数字を赤くするか (損失など) */
  negative?: boolean;
  /** この画面の視覚的主役として一段大きく描く */
  hero?: boolean;
  sub?: string;
  href?: string;
  linkLabel?: string;
}

export function StatTile({
  label,
  value,
  unit,
  diff,
  diffLabel = "前年比",
  negative = false,
  hero = false,
  sub,
  href,
  linkLabel,
}: StatTileProps) {
  return (
    <div
      className={[
        "rounded-xl border border-line p-4",
        hero ? "bg-brand-soft" : "bg-white",
      ].join(" ")}
    >
      <p className="text-xs text-ink-muted">{label}</p>
      <p
        className={[
          "num mt-1 font-bold",
          hero ? "text-4xl" : "text-2xl",
          negative ? "text-danger" : "text-ink",
        ].join(" ")}
      >
        {value}
        {unit && <span className="ml-0.5 text-[0.6em] font-semibold text-ink-muted">{unit}</span>}
      </p>

      {diff !== undefined && (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          {diff === null ? (
            <>{diffLabel} —</>
          ) : (
            <>
              {diffLabel}{" "}
              <span className={`num font-bold ${diff < 0 ? "text-danger" : "text-ink"}`}>
                {diff >= 0 ? "+" : "−"}
                {pct(Math.abs(diff))}
              </span>
            </>
          )}
        </p>
      )}

      {sub && <p className="mt-1 text-[11px] text-ink-muted">{sub}</p>}

      {href && linkLabel && (
        <Link
          href={href}
          className="mt-1.5 inline-block text-[11px] font-semibold text-brand-deep hover:underline"
        >
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}
