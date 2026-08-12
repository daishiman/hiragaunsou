import { describe, expect, it } from "vitest";
import {
  AXIS_BAND_TOP,
  approxTextWidth,
  computeTrendLayout,
  LAYOUT_TIERS,
  tierOf,
  type TrendPoint,
} from "../../../app/_components/charts/trendBarsLayout";

/**
 * 依頼者の指摘は「6ヶ月表示で棒が太すぎて見にくい」「月数で見た目が変わる」だった。
 * 原因は棒の太さを幅÷月数で決めていたことなので、直ったことを座標で固定する。
 * 見た目の決まりは trendBarsLayout.ts の LAYOUT_TIERS だけが持つ。
 */

const 万 = 10_000;

/** n ヶ月ぶんの点を作る (値は等しくしておき、幅の計算だけを見る) */
function points(n: number, value = 500 * 万): TrendPoint[] {
  return Array.from({ length: n }, (_, i) => ({ label: `${(i % 12) + 1}月`, value }));
}

const layoutOf = (n: number, width: number, override: Partial<TrendPoint>[] = []) =>
  computeTrendLayout({
    points: points(n).map((p, i) => ({ ...p, ...(override[i] ?? {}) })),
    width,
    signed: true,
    withReference: false,
  });

describe("推移グラフのレイアウト", () => {
  it("棒の太さは月数を減らしても段ごとの上限を超えない", () => {
    for (const n of [1, 2, 3, 4, 6, 13]) {
      const layout = layoutOf(n, 1200);
      expect(layout.barWidth, `${n}ヶ月の棒が太すぎる`).toBeLessThanOrEqual(
        tierOf(n).maxBarWidth,
      );
    }
  });

  it("カードが広くなっても棒は太らない (幅に比例させない)", () => {
    const narrow = layoutOf(6, 720);
    const wide = layoutOf(6, 1600);
    expect(wide.barWidth).toBe(narrow.barWidth);
    expect(wide.barWidth).toBeLessThanOrEqual(56);
  });

  it("棒の合計が描画域より狭いときは、かたまりを中央に置く", () => {
    const width = 1200;
    const layout = layoutOf(3, width);
    const first = layout.bars[0]!;
    const last = layout.bars[layout.bars.length - 1]!;
    const leftGap = first.x;
    const rightGap = width - (last.x + last.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(1);
  });

  it("隣り合う棒は必ず離れる (面がくっついて1本に見えない)", () => {
    for (const n of [3, 6, 13]) {
      const layout = layoutOf(n, 920);
      const gap = layout.slot - layout.barWidth;
      expect(gap, `${n}ヶ月で棒が接している`).toBeGreaterThanOrEqual(tierOf(n).minGap - 0.001);
    }
  });

  it("月数が少ないうちは全ての月に金額を出し、多くなったら最大の1点だけにする", () => {
    expect(layoutOf(6, 920).valueLabels).toHaveLength(6);
    expect(layoutOf(13, 920).valueLabels).toHaveLength(1);
  });

  it("金額が長くて隣の枠に食い込むときは、全点表示をやめて1点に落とす", () => {
    // 「▲1.23億円」が6つ並ぶと、狭い画面では1ヶ月ぶんの枠に収まらない
    const layout = computeTrendLayout({
      points: Array.from({ length: 6 }, (_, i) => ({
        label: `${i + 4}月`,
        value: -1.23 * 100_000_000,
      })),
      width: 360,
      signed: true,
      withReference: false,
    });
    expect(layout.valueLabels).toHaveLength(1);
  });

  it("全点に金額を出すときも、ラベル同士は横に重ならない", () => {
    const layout = computeTrendLayout({
      points: [
        { label: "4月", value: 9_303 * 万 },
        { label: "5月", value: -883 * 万 },
        { label: "6月", value: 1_234 * 万 },
        { label: "7月", value: -1_507 * 万 },
        { label: "8月", value: 61 * 万 },
        { label: "9月", value: 4_206 * 万 },
      ],
      width: 920,
      signed: true,
      withReference: false,
    });
    expect(layout.valueLabels).toHaveLength(6);
    for (let i = 1; i < layout.valueLabels.length; i += 1) {
      const prev = layout.valueLabels[i - 1]!;
      const cur = layout.valueLabels[i]!;
      const prevRight = prev.x + approxTextWidth(prev.text) / 2;
      const curLeft = cur.x - approxTextWidth(cur.text) / 2;
      expect(curLeft, `${prev.text} と ${cur.text} が重なる`).toBeGreaterThan(prevRight);
    }
  });

  it("値ラベルは横軸の月ラベルの帯に入らない (符号によらず)", () => {
    const layout = computeTrendLayout({
      points: [
        { label: "5月", value: 120 * 万 },
        { label: "6月", value: -883 * 万 },
        { label: "7月", value: 0 },
      ],
      width: 920,
      signed: true,
      withReference: false,
    });
    for (const label of layout.valueLabels) {
      expect(label.y, `${label.text} が月ラベルの帯に落ちている`).toBeLessThan(AXIS_BAND_TOP);
    }
  });

  it("画面が狭いほど月ラベルを強く間引く (文字が団子にならない)", () => {
    const wide = computeTrendLayout({
      points: points(13),
      width: 920,
      signed: false,
      withReference: false,
    });
    const narrow = computeTrendLayout({
      points: points(13),
      width: 360,
      signed: false,
      withReference: false,
    });
    expect(narrow.monthLabels.length).toBeLessThan(wide.monthLabels.length);
  });

  it("未取込の月と、実績がちょうど0円の月を描き分ける", () => {
    const layout = computeTrendLayout({
      points: [
        { label: "4月", value: 0, isEmpty: true },
        { label: "5月", value: 0 },
        { label: "6月", value: 300 * 万 },
      ],
      width: 920,
      signed: true,
      withReference: false,
    });
    expect(layout.bars.map((b) => b.kind)).toEqual(["empty", "zero", "value"]);
    expect(layout.hasEmpty).toBe(true);
    expect(layout.bars[0]!.tooltip).toBe("4月: 未取込");
    expect(layout.bars[1]!.tooltip).toBe("5月: 0円");
  });

  it("単月は線を引けないので、前年同月を棒に重ねる目印として描く", () => {
    const single = computeTrendLayout({
      points: [{ label: "2025/4月", value: 1_234 * 万, reference: 900 * 万 }],
      width: 920,
      signed: true,
      withReference: true,
    });
    expect(single.referenceLine).toBeNull();
    expect(single.referenceMarkers).toHaveLength(1);
    expect(single.hasReference).toBe(true);
    // 目印は棒より少しはみ出す長さにして、棒の一部に見えないようにする
    expect(single.referenceMarkers[0]!.x2 - single.referenceMarkers[0]!.x1).toBeGreaterThan(
      single.barWidth,
    );
  });

  it("単月で前年とほぼ同額でも、金額は前年の破線より外側に置く", () => {
    const layout = computeTrendLayout({
      points: [{ label: "2026/5月", value: 9_000 * 万, reference: 9_050 * 万 }],
      width: 920,
      signed: false,
      withReference: true,
    });
    const marker = layout.referenceMarkers[0]!;
    expect(layout.valueLabels[0]!.y).toBeLessThan(marker.y);
  });

  it("2点以上あれば前年は折れ線で描く", () => {
    const layout = computeTrendLayout({
      points: [
        { label: "4月", value: 100 * 万, reference: 80 * 万 },
        { label: "5月", value: 120 * 万, reference: 90 * 万 },
      ],
      width: 920,
      signed: false,
      withReference: true,
    });
    expect(layout.referenceLine).not.toBeNull();
    expect(layout.referenceMarkers).toHaveLength(0);
  });

  it("段の表は点数の小さい順に並び、最後は青天井を受ける", () => {
    const upTos = LAYOUT_TIERS.map((t) => t.upTo);
    expect([...upTos].sort((a, b) => a - b)).toEqual(upTos);
    expect(upTos[upTos.length - 1]).toBe(Number.POSITIVE_INFINITY);
  });
});
