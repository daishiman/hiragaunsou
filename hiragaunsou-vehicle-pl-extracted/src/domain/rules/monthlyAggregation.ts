/**
 * 月次集計ルール (mock/js/core.js の monthTotals / kmPrice に対応)。
 *
 * モックでは画面スクリプト内に埋まっていた集計を Domain 層の純粋関数として切り出す。
 * 経営ダッシュボード・年間集計・赤字分類の3画面が同じ数字を出すための唯一の定義。
 *
 * Domain層: フレームワーク非依存。D1・fetch等の外部依存を import しない。
 */
import type { VehiclePlCalculated } from "./vehiclePlCalculation";

export interface MonthTotals {
  /** 在籍台数 */
  cars: number;
  /** 稼働台数 (売上 > 0) */
  active: number;
  sales: number;
  expense: number;
  profit: number;
  km: number;
  tollNet: number;
  fuelTotal: number;
  repairTotal: number;
  laborTotal: number;
  insTotal: number;
  taxTotal: number;
  transportTotal: number;
  adminTotal: number;
  /** 赤字車両数 (損益 < 0) */
  deficitCars: number;
  /** 黒字車の利益合計 */
  profitPos: number;
  /** 赤字車の損失合計 (負値) */
  profitNeg: number;
}

const ZERO_TOTALS: MonthTotals = {
  cars: 0,
  active: 0,
  sales: 0,
  expense: 0,
  profit: 0,
  km: 0,
  tollNet: 0,
  fuelTotal: 0,
  repairTotal: 0,
  laborTotal: 0,
  insTotal: 0,
  taxTotal: 0,
  transportTotal: 0,
  adminTotal: 0,
  deficitCars: 0,
  profitPos: 0,
  profitNeg: 0,
};

const SUM_FIELDS = [
  "sales",
  "expense",
  "profit",
  "km",
  "tollNet",
  "fuelTotal",
  "repairTotal",
  "laborTotal",
  "insTotal",
  "taxTotal",
  "transportTotal",
  "adminTotal",
] as const satisfies readonly (keyof MonthTotals & keyof VehiclePlCalculated)[];

export type MonthTotalsSumField = (typeof SUM_FIELDS)[number];

/** 月次の全社集計。行が空でもゼロ埋めした MonthTotals を返す (画面側で分岐させない)。 */
export function monthTotals(rows: readonly VehiclePlCalculated[]): MonthTotals {
  const totals: MonthTotals = { ...ZERO_TOTALS, cars: rows.length };
  for (const row of rows) {
    for (const field of SUM_FIELDS) {
      totals[field] += numeric(row[field]);
    }
    if (numeric(row.sales) > 0) totals.active += 1;
    const profit = numeric(row.profit);
    if (profit < 0) {
      totals.deficitCars += 1;
      totals.profitNeg += profit;
    } else if (profit > 0) {
      totals.profitPos += profit;
    }
  }
  return totals;
}

/** km単価 (円/km)。稼働Kmが0の車両は算出不能として null を返す (0で割って Infinity にしない)。 */
export function kmPrice(row: Pick<VehiclePlCalculated, "km" | "sales">): number | null {
  const km = numeric(row.km);
  if (km <= 0) return null;
  return numeric(row.sales) / km;
}

/** 利益率。売上0の月は null (0除算を画面に漏らさない)。 */
export function marginOf(totals: Pick<MonthTotals, "sales" | "profit">): number | null {
  return totals.sales === 0 ? null : totals.profit / totals.sales;
}

/** 1kmあたり原価。走行0kmの月は null。 */
export function costPerKm(totals: Pick<MonthTotals, "km" | "expense">): number | null {
  return totals.km === 0 ? null : totals.expense / totals.km;
}

/** 1kmあたり売上。走行0kmの月は null。 */
export function salesPerKm(totals: Pick<MonthTotals, "km" | "sales">): number | null {
  return totals.km === 0 ? null : totals.sales / totals.km;
}

/** 複数月の MonthTotals を合算する (年間集計の合計行)。 */
export function sumMonthTotals(list: readonly MonthTotals[]): MonthTotals {
  const acc: MonthTotals = { ...ZERO_TOTALS };
  for (const t of list) {
    for (const field of SUM_FIELDS) acc[field] += t[field];
    acc.cars += t.cars;
    acc.active += t.active;
    acc.deficitCars += t.deficitCars;
    acc.profitPos += t.profitPos;
    acc.profitNeg += t.profitNeg;
  }
  return acc;
}

function numeric(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
