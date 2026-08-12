"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  computeTrendLayout,
  FALLBACK_WIDTH,
  FONT,
  type TrendPoint,
} from "./trendBarsLayout";

export type { TrendPoint } from "./trendBarsLayout";

/**
 * 月次推移の棒グラフ (0起点・同一単位の実数比較)。
 *
 * 描く座標は trendBarsLayout.ts が px で決める。ここは決まった座標に色と文字を置くだけ。
 *
 * 幅を測ってから描く理由:
 * - viewBox を固定して幅100%で伸ばすと、カードが広いほど棒も文字も同じ倍率で拡大される。
 *   6ヶ月表示で棒1本が200px近くになり、狭い画面では文字が読めない大きさまで縮む。
 * - 実寸で描けば「棒の太さの上限」も「文字の大きさ」も px で決められるので、
 *   期間 (単月/3/6/13ヶ月) を切り替えても同じ見た目のグラフになる。
 *
 * 配色の規律 (dataviz + jp-web-design):
 * - 実データ系列は brand / danger の2色だけ。この2色は CVD 検証済み
 *   (normal ΔE 34.1 / protan 23.2 / tritan 34.2 で全チェック PASS)。
 * - 前年は「データ系列」ではなく破線の参照 (注釈) に格下げする。
 *   青×グレーの2系列は normal ΔE 13.8 で見分けがつかないため、色ではなく
 *   線種でエンコードを分ける。
 * - 値は色だけで伝えない。符号は棒の向き + 直接ラベルでも分かるようにする。
 *
 * ラベルの規律:
 * - 横軸の月ラベルは画面下部の専用の帯に置き、値ラベルはそこへ入らない
 *   (負の棒の値ラベルが「7月」等と重なって読めなくなる事故を構造的に防ぐ)。
 * - 値ラベルの居場所は棒の長さの計算段階で確保する。位置合わせで後から避けると、
 *   期間や符号の組み合わせのどれかで必ず破綻する。
 */
export interface TrendBarsProps {
  points: readonly TrendPoint[];
  /** グラフの見出し (アクセシビリティ上の系列名を兼ねる) */
  title: string;
  /** 参照 (前年) の凡例ラベル。省略時は前年を描かない。 */
  referenceLabel?: string;
  /** 負値を danger 色にするか (損益=true / 売上=false) */
  signed?: boolean;
}

/** 描画前のサーバー側では実行されない useLayoutEffect の警告を避ける */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * 置かれた場所の幅 (px) を返す。まだ測れていない間は既定幅を返し、
 * 測れた瞬間に描き直す (カードの折り返しや画面回転にも追従する)。
 */
function useMeasuredWidth() {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || null);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width: width ?? FALLBACK_WIDTH, measured: width !== null };
}

export function TrendBars({ points, title, referenceLabel, signed = false }: TrendBarsProps) {
  const { ref, width, measured } = useMeasuredWidth();
  if (points.length === 0) return null;

  const layout = computeTrendLayout({
    points,
    width,
    signed,
    withReference: referenceLabel !== undefined,
  });

  return (
    <figure className="m-0" ref={ref} data-chart-width={measured ? layout.width : undefined}>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        className="block max-w-full"
        role="img"
        aria-label={`${title}の月次推移`}
      >
        {/* 0 の基準線だけを引く。目盛り線は情報量を増やすだけなので描かない */}
        <line
          x1={0}
          y1={layout.zeroY}
          x2={layout.width}
          y2={layout.zeroY}
          stroke="var(--line)"
          strokeWidth={1}
        />

        {layout.bars.map((bar, i) => (
          // label は "9月" のように年をまたいで重複しうるため、位置で key を振る
          <g key={i}>
            {bar.kind === "empty" ? (
              // 未取込の月は「0円の実績」と紛らわしいので、点線の枠だけを置く
              <rect
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill="none"
                stroke="var(--line)"
                strokeDasharray="2 2"
                rx={2}
              />
            ) : (
              <rect
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx={bar.kind === "zero" ? 1 : 4}
                fill={bar.negative ? "var(--danger)" : "var(--brand)"}
              />
            )}
            <title>{bar.tooltip}</title>
          </g>
        ))}

        {/* 前年は破線。色ではなく線種で当期と区別する */}
        {layout.referenceLine && (
          <polyline
            points={layout.referenceLine}
            fill="none"
            stroke="var(--ink-muted)"
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinecap="round"
          />
        )}
        {/* 単月は線が引けないので、その月の高さに前年の目印を渡す */}
        {layout.referenceMarkers.map((m, i) => (
          <line
            key={i}
            x1={m.x1}
            y1={m.y}
            x2={m.x2}
            y2={m.y}
            stroke="var(--ink-muted)"
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinecap="round"
          />
        ))}

        {layout.monthLabels.map((label, i) => (
          <text
            key={i}
            x={label.x}
            y={label.y}
            textAnchor="middle"
            fontSize={FONT}
            fill="var(--ink-muted)"
          >
            {label.text}
          </text>
        ))}

        {layout.valueLabels.map((label, i) => (
          <text
            key={i}
            x={label.x}
            y={label.y}
            textAnchor="middle"
            fontSize={FONT}
            fontWeight={700}
            fill="var(--ink)"
            /*
              前年の破線が金額の真上を通ると字が読めなくなるので、字の背後だけ
              カードの地色で縁取る (paint-order=stroke なので線は字の外側に出ない)。
            */
            paintOrder="stroke"
            stroke="#fff"
            strokeWidth={3}
            strokeLinejoin="round"
          >
            {label.text}
          </text>
        ))}
      </svg>

      {(layout.hasReference || layout.hasEmpty) && (
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
          {layout.hasReference && (
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
          )}
          {layout.hasEmpty && (
            <span className="inline-flex items-center gap-1.5">
              <svg width="12" height="10" aria-hidden="true">
                <rect
                  x="0.5"
                  y="0.5"
                  width="11"
                  height="9"
                  fill="none"
                  stroke="var(--line)"
                  strokeDasharray="2 2"
                  rx="2"
                />
              </svg>
              未取込の月
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
