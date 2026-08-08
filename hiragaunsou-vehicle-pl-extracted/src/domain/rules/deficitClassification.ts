/**
 * 赤字3分類ルール (mock/js/core.js の DEFICIT_RULES / classifyDeficit に対応)。
 *
 * 「黒字か赤字か」で議論を止めないための分類。閾値はハードコードせず rate_master から差し替える
 * (要件定義「ハードコード禁止」に準拠。既定値はモックの暫定ルールと同値)。
 *
 * Domain層: フレームワーク非依存。D1・fetch等の外部依存を import しない。
 */
import type { VehiclePlCalculated } from "./vehiclePlCalculation";
import { kmPrice } from "./monthlyAggregation";

export interface DeficitThresholds {
  /** 売上がこれ未満なら遊休・低稼働型 (円) */
  idleSales: number;
  /** 修理費実費がこれ以上なら突発修繕型 (円) */
  repairSpike: number;
  /** km単価の損益分岐目安 (円/km) */
  breakEvenKmPrice: number;
}

/**
 * rate_master に行が無いときだけ使われる保険値 (モックの暫定ルールと同値)。業務上の正ではない。
 *
 * breakEvenKmPrice の 170 はモック由来のきりの良い数字で、2026-08 の実測 (稼働車の
 * 経費計÷稼働Km) は 176.9 円/km だった。実測に合わせた 177 は migrations/0015 で
 * rate_master に投入済み。ここを書き換えるのではなく、値を変えたいときは
 * rate_master を更新する (既定値を動かすと、マスタが未設定の環境だけ挙動が変わる)。
 */
export const DEFAULT_DEFICIT_THRESHOLDS: DeficitThresholds = {
  idleSales: 300000,
  repairSpike: 300000,
  breakEvenKmPrice: 170,
};

export type DeficitCategory = "repair" | "price" | "idle";

export const DEFICIT_CATEGORY_ORDER: readonly DeficitCategory[] = ["repair", "price", "idle"];

export type DeficitGroups = Record<DeficitCategory, VehiclePlCalculated[]>;

/**
 * 赤字車両を3分類する。判定順序が結果を決めるため順序を固定する:
 *   1. 売上 < idleSales      → 遊休・低稼働型 (そもそも稼いでいない)
 *   2. 修理費実費 >= repairSpike → 突発修繕型 (単月の一括計上)
 *   3. それ以外               → 単価・効率型 (稼働しているのに赤字)
 */
export function classifyDeficit(
  rows: readonly VehiclePlCalculated[],
  thresholds: DeficitThresholds = DEFAULT_DEFICIT_THRESHOLDS,
): DeficitGroups {
  const groups: DeficitGroups = { repair: [], price: [], idle: [] };
  for (const row of rows) {
    if (row.profit >= 0) continue;
    if (row.sales < thresholds.idleSales) groups.idle.push(row);
    else if (row.repair >= thresholds.repairSpike) groups.repair.push(row);
    else groups.price.push(row);
  }
  return groups;
}

export interface KmPriceBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  deficit: number;
  /** バケット全体が損益分岐を下回るか (グラフの赤塗り判定) */
  belowBreakEven: boolean;
}

const BUCKET_DEFS: readonly { label: string; min: number; max: number }[] = [
  { label: "130円未満", min: 0, max: 130 },
  { label: "130〜150円", min: 130, max: 150 },
  { label: "150〜170円", min: 150, max: 170 },
  { label: "170〜190円", min: 170, max: 190 },
  { label: "190〜210円", min: 190, max: 210 },
  { label: "210円以上", min: 210, max: Number.POSITIVE_INFINITY },
];

/** km単価の分布 (稼働車のみ)。稼働Km 0 の車両は算出不能なので集計から除く。 */
export function kmPriceBuckets(
  rows: readonly VehiclePlCalculated[],
  breakEvenKmPrice: number = DEFAULT_DEFICIT_THRESHOLDS.breakEvenKmPrice,
): KmPriceBucket[] {
  const buckets: KmPriceBucket[] = BUCKET_DEFS.map((b) => ({
    ...b,
    count: 0,
    deficit: 0,
    belowBreakEven: b.max <= breakEvenKmPrice,
  }));
  for (const row of rows) {
    const price = kmPrice(row);
    if (price === null) continue;
    const bucket = buckets.find((b) => price >= b.min && price < b.max);
    if (!bucket) continue;
    bucket.count += 1;
    if (row.profit < 0) bucket.deficit += 1;
  }
  return buckets;
}
