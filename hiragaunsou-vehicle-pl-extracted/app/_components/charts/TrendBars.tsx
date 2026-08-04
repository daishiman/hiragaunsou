import { man, yen } from "../../_lib/format";

/**
 * 月次推移の棒グラフ (0起点・同一単位の実数比較)。
 *
 * 配色の規律 (dataviz + jp-web-design):
 * - 実データ系列は brand / danger の2色だけ。この2色は CVD 検証済み
 *   (normal ΔE 34.1 / protan 23.2 / tritan 34.2 で全チェック PASS)。
 * - 前年は「データ系列」ではなく破線の参照線 (注釈) に格下げする。
 *   青×グレーの2系列は normal ΔE 13.8 で見分けがつかないため、色ではなく
 *   線種でエンコードを分ける。
 * - 値は色だけで伝えない。符号は棒の向き + 直接ラベルでも分かるようにする。
 */
export interface TrendPoint {
  label: string;
  value: number;
  /** 前年同月の値 (無ければ null)。破線の参照線として重ねる。 */
  reference?: number | null;
  /** その月のデータが未取込か (取込漏れと「0円」を描き分ける) */
  isEmpty?: boolean;
}

export interface TrendBarsProps {
  points: readonly TrendPoint[];
  /** グラフの見出し (アクセシビリティ上の系列名を兼ねる) */
  title: string;
  /** 参照線の凡例ラベル。省略時は参照線を描かない。 */
  referenceLabel?: string;
  /** 負値を danger 色にするか (損益=true / 売上=false) */
  signed?: boolean;
}

const W = 640;
const H = 190;
const PAD_X = 8;
const PAD_TOP = 22;
const PAD_BOTTOM = 26;

export function TrendBars({ points, title, referenceLabel, signed = false }: TrendBarsProps) {
  if (points.length === 0) return null;

  const values = points.flatMap((p) => [p.value, ...(p.reference == null ? [] : [p.reference])]);
  const maxV = Math.max(...values, 0);
  const minV = Math.min(...values, 0);
  const span = Math.max(maxV - minV, 1);

  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const slot = (W - PAD_X * 2) / points.length;
  // 隣り合う棒の間に 2px の地の隙間を空ける (面がくっつくと1本に見える)
  const barW = Math.max(slot - 6, 4);
  const yOf = (v: number) => PAD_TOP + ((maxV - v) / span) * plotH;
  const zeroY = yOf(0);

  const hasReference = referenceLabel !== undefined && points.some((p) => p.reference != null);
  const refPoints = points
    .map((p, i) => (p.reference == null ? null : `${PAD_X + slot * i + slot / 2},${yOf(p.reference)}`))
    .filter((s): s is string => s !== null);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${title}の月次推移`}
      >
        {/* 0 の基準線だけを引く。目盛り線は情報量を増やすだけなので描かない */}
        <line x1={PAD_X} y1={zeroY} x2={W - PAD_X} y2={zeroY} stroke="var(--line)" strokeWidth={1} />

        {points.map((p, i) => {
          const x = PAD_X + slot * i + (slot - barW) / 2;
          const top = Math.min(yOf(p.value), zeroY);
          const h = Math.max(Math.abs(yOf(p.value) - zeroY), p.isEmpty ? 0 : 1.5);
          const negative = signed && p.value < 0;
          return (
            <g key={p.label}>
              {p.isEmpty ? (
                // 未取込の月は「0円の実績」と紛らわしいので、点線の枠だけを置く
                <rect
                  x={x}
                  y={zeroY - 10}
                  width={barW}
                  height={10}
                  fill="none"
                  stroke="var(--line)"
                  strokeDasharray="2 2"
                  rx={2}
                />
              ) : (
                <rect
                  x={x}
                  y={top}
                  width={barW}
                  height={h}
                  rx={4}
                  fill={negative ? "var(--danger)" : "var(--brand)"}
                />
              )}
              <title>
                {p.isEmpty
                  ? `${p.label}: 未取込`
                  : `${p.label}: ${yen(p.value)}円${
                      p.reference == null ? "" : ` / 前年 ${yen(p.reference)}円`
                    }`}
              </title>
              <text
                x={x + barW / 2}
                y={H - 9}
                textAnchor="middle"
                fontSize={11}
                fill="var(--ink-muted)"
              >
                {p.label}
              </text>
            </g>
          );
        })}

        {/* 前年は破線の参照線。色ではなく線種で当期と区別する */}
        {hasReference && refPoints.length >= 2 && (
          <polyline
            points={refPoints.join(" ")}
            fill="none"
            stroke="var(--ink-muted)"
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinecap="round"
          />
        )}

        {/* 最大・最小だけ直接ラベルを置く (全点に数字を振らない) */}
        {(() => {
          const peak = points.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
          if (peak.isEmpty || peak.value === 0) return null;
          const i = points.indexOf(peak);
          const above = peak.value >= 0;
          return (
            <text
              x={PAD_X + slot * i + slot / 2}
              y={above ? yOf(peak.value) - 6 : yOf(peak.value) + 14}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="var(--ink)"
            >
              {man(peak.value)}
            </text>
          );
        })()}
      </svg>

      {hasReference && (
        <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand" aria-hidden="true" />
            当期
          </span>
          {signed && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-danger" aria-hidden="true" />
              赤字の月
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true">
              <line
                x1="0"
                y1="3"
                x2="18"
                y2="3"
                stroke="var(--ink-muted)"
                strokeWidth="2"
                strokeDasharray="5 4"
              />
            </svg>
            {referenceLabel}
          </span>
        </figcaption>
      )}
    </figure>
  );
}
