import { man, yen } from "../../_lib/format";

/**
 * 月次推移グラフの「どこに何を何px で描くか」を決める計算。描画 (TrendBars.tsx) から
 * 完全に切り離してあるので、期間 (単月/3/6/13ヶ月) ごとの見え方はここだけを読めば分かる。
 *
 * ここを別ファイルにした理由:
 * - 期間ごとのレイアウトの決まりが JSX の中に散らばると、「6ヶ月だけ棒が巨大」のような
 *   崩れがどこから来たのか追えない。決まりは下の LAYOUT_TIERS の1表に閉じ込める。
 * - 文字の重なりは座標の問題なので、ブラウザを起動しなくても表として検査できるようにする。
 *
 * 座標の単位は **実際の画面の px** で、SVG の viewBox を引き伸ばして使わない。
 * viewBox を固定して幅100%で伸ばす描き方だと、カードが広いほど棒も文字も同じ倍率で
 * 拡大され、6ヶ月表示で棒1本が200px近くまで太る (依頼者の指摘そのもの)。
 * 逆に狭い画面では文字が4pxまで潰れる。倍率を持たせないことが、この崩れの根治になる。
 */

export interface TrendPoint {
  label: string;
  value: number;
  /** 前年同月の値 (無ければ null)。破線の参照として重ねる。 */
  reference?: number | null;
  /** その月のデータが未取込か (取込漏れと「0円」を描き分ける) */
  isEmpty?: boolean;
}

/**
 * 期間ごとのレイアウトの決まり (この表が唯一の正本)。
 *
 * 棒の太さは「月数で割った幅」ではなく上限つきで決める。月数が減っても棒は太らず、
 * 増えても最低限の太さを保つので、期間を切り替えても同じグラフに見える。
 * 棒の合計幅が描画域より狭いときは、左に寄せず中央に集める (端に寄ると余白が片側に偏る)。
 */
export interface TrendLayoutTier {
  /** この段が受け持つ点数の上限 */
  upTo: number;
  /** 棒の太さの上限 (px)。カードが広くてもこれ以上は太らせない。 */
  maxBarWidth: number;
  /** 隣の棒との最小の隙間 (px)。面がくっついて1本に見えるのを防ぐ。 */
  minGap: number;
  /** 値ラベルを全点に出すか、いちばん大きい1点だけにするか */
  valueLabels: "all" | "peak";
  /** 前年の描き方。点が1つだと線が引けないので、その月だけの目印にする。 */
  reference: "marker" | "line";
}

export const LAYOUT_TIERS: readonly TrendLayoutTier[] = [
  // 単月: 棒は1本。前年同月の破線を「その月の目印」として重ねると比較の相手ができるので、
  // 数字1つを大きく出す表示には替えず、棒のまま扱いを統一する (期間を切り替えても形が変わらない)。
  { upTo: 1, maxBarWidth: 96, minGap: 24, valueLabels: "all", reference: "marker" },
  { upTo: 3, maxBarWidth: 72, minGap: 24, valueLabels: "all", reference: "line" },
  { upTo: 6, maxBarWidth: 56, minGap: 18, valueLabels: "all", reference: "line" },
  { upTo: 13, maxBarWidth: 34, minGap: 10, valueLabels: "peak", reference: "line" },
  // 14ヶ月以上は今の画面には無いが、増やしたときに潰れないよう受け皿だけ置く
  { upTo: Number.POSITIVE_INFINITY, maxBarWidth: 24, minGap: 6, valueLabels: "peak", reference: "line" },
];

export function tierOf(pointCount: number): TrendLayoutTier {
  return LAYOUT_TIERS.find((t) => pointCount <= t.upTo) ?? LAYOUT_TIERS[LAYOUT_TIERS.length - 1]!;
}

/** 高さは期間で変えない (切り替えたときにカードの高さが跳ねると比較しづらい) */
export const H = 220;
export const PAD_X = 8;
export const PAD_TOP = 24;
export const PAD_BOTTOM = 28;
export const FONT = 11;
/** ここから下は横軸の月ラベル専用の帯。値ラベルを絶対に侵入させない */
export const AXIS_BAND_TOP = H - PAD_BOTTOM;
/** 値ラベルのベースラインの下限 (下げるとしても月ラベルの帯の手前で止める) */
export const MAX_BASELINE = AXIS_BAND_TOP - 3;
/** 値ラベルのベースラインの上限 (上げすぎると描画域の外で見切れる) */
export const MIN_BASELINE = FONT;
/**
 * 負の棒の下に確保する値ラベル用の余白。
 * ここを取らずに描くと「▲883万円」が横軸の「7月」と同じ座標に落ちて読めなくなる。
 */
export const NEGATIVE_LABEL_BAND = 16;
/** 未取込の月に置く点線の枠の高さ */
export const EMPTY_MARK_H = 10;
/** 実績が「ちょうど0円」の月に置く、0線の上の細い実線 (未取込との描き分け) */
export const ZERO_MARK_H = 3;
/** 幅を測る前 (サーバー側の描画) に使う既定の幅。測れたら実寸で描き直す。 */
export const FALLBACK_WIDTH = 720;
/** これ以上狭いカードは想定しない (下限を置かないと棒が消える) */
export const MIN_WIDTH = 240;

/**
 * SVGのtextは自動で折り返さず、はみ出した分は描画域の外で切れる。
 * 全角 (▲・万・億・円・月) は約1em、半角の数字・記号は約0.58em として概算する。
 */
export function approxTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[0-9.,/-]/.test(ch) ? FONT * 0.58 : FONT;
  return w;
}

export interface BarShape {
  x: number;
  y: number;
  width: number;
  height: number;
  /** value = 実績の棒 / zero = ちょうど0円 / empty = 未取込 */
  kind: "value" | "zero" | "empty";
  negative: boolean;
  tooltip: string;
}

export interface TextShape {
  x: number;
  y: number;
  text: string;
}

export interface ReferenceMarker {
  x1: number;
  x2: number;
  y: number;
}

export interface TrendLayout {
  width: number;
  height: number;
  zeroY: number;
  barWidth: number;
  slot: number;
  tier: TrendLayoutTier;
  bars: BarShape[];
  monthLabels: TextShape[];
  valueLabels: TextShape[];
  /** 2点以上あるときの前年の折れ線 (polyline の points) */
  referenceLine: string | null;
  /** 単月のときの前年の目印 */
  referenceMarkers: ReferenceMarker[];
  hasReference: boolean;
  hasEmpty: boolean;
}

export interface TrendLayoutInput {
  points: readonly TrendPoint[];
  /** 実際に描ける幅 (px)。測る前は FALLBACK_WIDTH を渡す。 */
  width: number;
  /** 負値を danger 色にするか (損益=true / 売上=false) */
  signed: boolean;
  /** 前年を描くか (referenceLabel が指定されているか) */
  withReference: boolean;
  /** 金額の表示に使う書式 (既定は万円) */
  formatValue?: (value: number) => string;
}

/** 中央揃えラベルの基準Xを描画域の内側に寄せる (両端の "2025/9月" 等が切れるのを防ぐ) */
function clampCenterX(cx: number, text: string, width: number): number {
  const half = approxTextWidth(text) / 2;
  const min = PAD_X + half;
  const max = width - PAD_X - half;
  return min > max ? width / 2 : Math.min(Math.max(cx, min), max);
}

export function computeTrendLayout({
  points,
  width,
  signed,
  withReference,
  formatValue = man,
}: TrendLayoutInput): TrendLayout {
  const W = Math.max(width, MIN_WIDTH);
  const tier = tierOf(points.length);

  const values = points.flatMap((p) => [p.value, ...(p.reference == null ? [] : [p.reference])]);
  const maxV = Math.max(...values, 0);
  const minV = Math.min(...values, 0);
  const span = Math.max(maxV - minV, 1);

  // 下に伸びる棒があるときだけ、棒が届く一番下を持ち上げて値ラベルの居場所を作る
  const plotH = H - PAD_TOP - PAD_BOTTOM - (minV < 0 ? NEGATIVE_LABEL_BAND : 0);
  const yOf = (v: number) => PAD_TOP + ((maxV - v) / span) * plotH;
  const zeroY = yOf(0);

  // 棒の太さと間隔: 「幅 ÷ 月数」ではなく上限つきで決める。
  // 決めた合計幅が描画域より狭ければ、そのかたまりを中央に置く。
  const available = W - PAD_X * 2;
  const slot = Math.min(available / points.length, tier.maxBarWidth + tier.minGap);
  const barWidth = Math.max(Math.min(slot - tier.minGap, tier.maxBarWidth), 3);
  const originX = PAD_X + Math.max((available - slot * points.length) / 2, 0);
  const centerOf = (i: number) => originX + slot * i + slot / 2;

  const bars: BarShape[] = points.map((p, i) => {
    const x = centerOf(i) - barWidth / 2;
    if (p.isEmpty) {
      return {
        x,
        y: zeroY - EMPTY_MARK_H,
        width: barWidth,
        height: EMPTY_MARK_H,
        kind: "empty",
        negative: false,
        tooltip: `${p.label}: 未取込`,
      };
    }
    // マウスを乗せたときだけは丸めない実額を出す (棒の上のラベルは万円で読ませる)
    const tooltip = `${p.label}: ${yen(p.value)}円${
      p.reference == null ? "" : ` / 前年 ${yen(p.reference)}円`
    }`;
    if (p.value === 0) {
      // 実績としての0円。未取込 (点線の枠) と紛れないよう、0線の上に細い実線を置く
      return {
        x,
        y: zeroY - ZERO_MARK_H,
        width: barWidth,
        height: ZERO_MARK_H,
        kind: "zero",
        negative: false,
        tooltip,
      };
    }
    const tipY = yOf(p.value);
    return {
      x,
      y: Math.min(tipY, zeroY),
      width: barWidth,
      height: Math.max(Math.abs(tipY - zeroY), 1.5),
      kind: "value",
      negative: signed && p.value < 0,
      tooltip,
    };
  });

  // 月ラベルの間引きは「隣の文字と当たるか」で決める。
  // 画面が狭いほど自動的に間引きが強くなるので、タブレットでも文字が団子にならない。
  const widestMonthLabel = Math.max(...points.map((p) => approxTextWidth(p.label)));
  const labelStep = Math.max(1, Math.ceil((widestMonthLabel + 6) / slot));
  const lastIndex = points.length - 1;
  const lastNaturalStep = Math.floor(lastIndex / labelStep) * labelStep;
  // 末尾は「直近がいつか」を示すため優先して出すが、直前の間引きラベルと近すぎるときは諦める
  const showLastLabel = lastIndex - lastNaturalStep >= Math.ceil(labelStep / 2);
  const monthLabels: TextShape[] = points
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % labelStep === 0 || (i === lastIndex && showLastLabel))
    .map(({ p, i }) => ({
      x: clampCenterX(centerOf(i), p.label, W),
      y: H - 9,
      text: p.label,
    }));

  // 値ラベルの置き方。全点に出せるのは、どのラベルも隣の枠に食い込まないときだけ。
  // 入らないと分かった時点で「いちばん大きい1点だけ」に落とす (後から避けても必ずどこかで破綻する)。
  const labelable = points
    .map((p, i) => ({ p, i, text: formatValue(p.value) }))
    .filter(({ p }) => !p.isEmpty);
  const fitsAll =
    tier.valueLabels === "all" &&
    labelable.every(({ text }) => approxTextWidth(text) <= slot - 4);
  const targets = fitsAll
    ? labelable
    : (() => {
        const peak = points.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
        if (peak.isEmpty || peak.value === 0) return [];
        const i = points.indexOf(peak);
        return [{ p: peak, i, text: formatValue(peak.value) }];
      })();

  const valueLabels: TextShape[] = targets.map(({ p, i, text }) => {
    const bareTipY = p.value === 0 ? zeroY - ZERO_MARK_H : yOf(p.value);
    // 単月は前年の破線が棒の真横に来る。値が前年とほぼ同じだと破線が金額の字を貫くので、
    // 棒と破線の「外側」を先端とみなして、そのさらに外へ金額を置く。
    const markedReference =
      withReference && tier.reference === "marker" && p.reference != null ? yOf(p.reference) : null;
    const tipY =
      markedReference === null
        ? bareTipY
        : p.value >= 0
          ? Math.min(bareTipY, markedReference)
          : Math.max(bareTipY, markedReference);
    // 値ラベルは常に棒の外側 (先端の続き) に置く。上下とも先に余白を取ってあるので、
    // 上は描画域から、下は横軸の月ラベルの帯からはみ出さない。
    const y =
      p.value >= 0 ? Math.max(tipY - 6, MIN_BASELINE) : Math.min(tipY + 12, MAX_BASELINE);
    return { x: clampCenterX(centerOf(i), text, W), y, text };
  });

  const hasReference = withReference && points.some((p) => p.reference != null);
  const referenceLine =
    hasReference && tier.reference === "line"
      ? (() => {
          const pts = points
            .map((p, i) => (p.reference == null ? null : `${centerOf(i)},${yOf(p.reference)}`))
            .filter((s): s is string => s !== null);
          return pts.length >= 2 ? pts.join(" ") : null;
        })()
      : null;
  const referenceMarkers: ReferenceMarker[] =
    hasReference && tier.reference === "marker"
      ? points.flatMap((p, i) =>
          p.reference == null
            ? []
            : [
                {
                  x1: centerOf(i) - barWidth / 2 - 8,
                  x2: centerOf(i) + barWidth / 2 + 8,
                  y: yOf(p.reference),
                },
              ],
        )
      : [];

  return {
    width: W,
    height: H,
    zeroY,
    barWidth,
    slot,
    tier,
    bars,
    monthLabels,
    valueLabels,
    referenceLine,
    referenceMarkers,
    hasReference: hasReference && (referenceLine !== null || referenceMarkers.length > 0),
    hasEmpty: points.some((p) => p.isEmpty),
  };
}
