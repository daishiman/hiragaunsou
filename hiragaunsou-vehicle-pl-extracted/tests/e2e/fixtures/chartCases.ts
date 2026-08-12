import { chartMonthLabel } from "../../../app/_lib/format";
import type { TrendBarsProps, TrendPoint } from "../../../app/_components/charts/TrendBars";

/**
 * 推移グラフの検査用データ。
 *
 * 実際に文字が重なったのは「7月が赤字で、その月の金額 ▲883万円 が横軸の 7月 に被った」
 * ときだった。つまり壊れるのは **数字の組み合わせ** であって、画面でも部品でもない。
 * そこで、壊れやすい組み合わせを代表境界ケースとしてここに並べる。
 *
 *   - 期間: 単月 / 3ヶ月 / 6ヶ月 / 13ヶ月 (画面で選べる幅すべて)
 *   - 符号: 全部黒字 / 全部赤字 / 混在 / ちょうど0
 *   - 桁: 数千円から億円まで。桁が増えると値ラベルの文字数が増えて隣とぶつかる
 *   - 未取込の月 (点線の枠だけになる月) が混ざる並び
 */

/** 2025-04 を起点に n ヶ月ぶんの年月を作る (1月をまたぐので年つきラベルも混ざる)。 */
function months(count: number, startYear = 2025, startMonth = 4): string[] {
  return Array.from({ length: count }, (_, i) => {
    const m = startMonth - 1 + i;
    const year = startYear + Math.floor(m / 12);
    return `${year}-${String((m % 12) + 1).padStart(2, "0")}`;
  });
}

/** 値の並びから、本番と同じラベルの付け方で points を作る。 */
function pointsOf(
  values: readonly (number | null)[],
  options: { references?: readonly (number | null)[]; startMonth?: number } = {},
): TrendPoint[] {
  const ym = months(values.length, 2025, options.startMonth ?? 4);
  return values.map((value, i) => ({
    label: chartMonthLabel(ym[i]!, i),
    value: value ?? 0,
    isEmpty: value === null,
    reference: options.references?.[i] ?? null,
  }));
}

export interface ChartCase {
  name: string;
  props: TrendBarsProps;
  /** このケースを描いたと証明する、グラフ部品内の代表ラベル。 */
  expectedLabels: readonly string[];
}

const 万 = 10_000;
const 億 = 100_000_000;

export const CHART_CASES: readonly ChartCase[] = [
  {
    name: "単月・黒字",
    props: { title: "損益", signed: true, points: pointsOf([1_234 * 万]) },
    expectedLabels: ["2025/4月", "1,234万円"],
  },
  {
    name: "単月・赤字",
    props: { title: "損益", signed: true, points: pointsOf([-883 * 万]) },
    expectedLabels: ["2025/4月", "▲883万円"],
  },
  {
    name: "単月・ちょうど0",
    props: { title: "損益", signed: true, points: pointsOf([0]) },
    expectedLabels: ["2025/4月"],
  },
  {
    name: "3ヶ月・黒字と赤字が混ざる",
    props: {
      title: "損益",
      signed: true,
      points: pointsOf([420 * 万, -883 * 万, 61 * 万]),
      referenceLabel: "前年同月",
    },
    expectedLabels: ["2025/4月", "▲883万円"],
  },
  {
    name: "3ヶ月・最後の月が最大の赤字 (値ラベルが右端に来る)",
    props: {
      title: "損益",
      signed: true,
      points: pointsOf([120 * 万, 90 * 万, -1_507 * 万]),
    },
    expectedLabels: ["2025/4月", "▲1,507万円"],
  },
  {
    name: "3ヶ月・最初の月が最大の赤字 (値ラベルが左端に来る)",
    props: {
      title: "損益",
      signed: true,
      points: pointsOf([-1_507 * 万, 90 * 万, 120 * 万]),
    },
    expectedLabels: ["2025/4月", "▲1,507万円"],
  },
  {
    name: "6ヶ月・赤字混在 + 未取込の月",
    props: {
      title: "損益",
      signed: true,
      points: pointsOf([310 * 万, -742 * 万, 0, null, 155 * 万, -98 * 万]),
      referenceLabel: "前年同月",
    },
    expectedLabels: ["2025/4月", "▲742万円"],
  },
  {
    name: "13ヶ月・赤字混在 + 前年同月あり (年間集計と同じ形)",
    props: {
      title: "損益",
      signed: true,
      points: pointsOf(
        [
          520 * 万,
          480 * 万,
          -883 * 万,
          310 * 万,
          95 * 万,
          -1_204 * 万,
          640 * 万,
          720 * 万,
          -55 * 万,
          410 * 万,
          380 * 万,
          -960 * 万,
          1_150 * 万,
        ],
        {
          references: [
            500 * 万,
            460 * 万,
            120 * 万,
            300 * 万,
            100 * 万,
            -300 * 万,
            600 * 万,
            700 * 万,
            50 * 万,
            400 * 万,
            360 * 万,
            -400 * 万,
            1_000 * 万,
          ],
        },
      ),
      referenceLabel: "前年同月",
    },
    expectedLabels: ["2025/4月", "▲1,204万円", "前年同月"],
  },
  {
    name: "13ヶ月・全部赤字",
    props: {
      title: "損益",
      signed: true,
      points: pointsOf(
        Array.from({ length: 13 }, (_, i) => -((i + 1) * 137 * 万)),
      ),
    },
    expectedLabels: ["2025/4月", "▲1,781万円"],
  },
  {
    name: "13ヶ月・億単位 (値ラベルの文字数が最大)",
    props: {
      title: "売上",
      points: pointsOf(
        Array.from({ length: 13 }, (_, i) => (i === 5 ? 12.34 * 億 : 3.2 * 億)),
      ),
      referenceLabel: "前年同月",
    },
    expectedLabels: ["2025/4月", "12.34億円"],
  },
  {
    name: "13ヶ月・億単位の赤字が最後の月 (右端で最長の値ラベル)",
    props: {
      title: "損益",
      signed: true,
      points: pointsOf([
        ...Array.from({ length: 12 }, () => 25 * 万),
        -9.87 * 億,
      ]),
    },
    expectedLabels: ["2025/4月", "▲9.87億円"],
  },
  {
    name: "13ヶ月・極端に小さい値ばかり (棒がほぼ0の高さ)",
    props: {
      title: "損益",
      signed: true,
      points: pointsOf(
        Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? 3_000 : -2_500)),
      ),
    },
    expectedLabels: ["2025/4月", "0万円"],
  },
  {
    name: "13ヶ月・1月をまたいで年つきラベルが増える",
    props: {
      title: "売上",
      points: pointsOf(
        Array.from({ length: 13 }, (_, i) =>
          i === 4 ? 8_450 * 万 : 5_100 * 万,
        ),
        { startMonth: 10 },
      ),
      referenceLabel: "前年同月",
    },
    expectedLabels: ["2025/10月", "8,450万円"],
  },
];
