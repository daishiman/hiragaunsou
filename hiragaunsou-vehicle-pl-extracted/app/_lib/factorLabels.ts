import type { DeficitFactorCategory } from "../../src/domain/repositories/DeficitFactorAnalysisRepository";

/**
 * 赤字の要因分類の日本語ラベル。
 *
 * COST_BREAKDOWN_FIELDS (getVehicleHistory.ts) と対応する。
 * 車両の詳細と赤字分析の2画面で使う。かつては車両の詳細にしか表が無く、
 * 赤字分析の札には `fuelTotal` のような英語のキーがそのまま出ていた。
 * 画面に英語のキーを出さない (docs/product/T7-ui-conventions.md §1-3)。
 */
export const FACTOR_CATEGORY_LABELS: Record<DeficitFactorCategory, string> = {
  sales: "売上",
  tollNet: "運行費",
  fuelTotal: "燃料費",
  repairTotal: "修繕費",
  laborTotal: "人件費",
  insTotal: "保険料",
  taxTotal: "賦課税",
  transportTotal: "運送費",
  adminTotal: "一般管理費",
};

/** 文字列で来た分類を日本語にする。知らない値も内部キーは画面に出さない。 */
export function factorCategoryLabel(category: string): string {
  return FACTOR_CATEGORY_LABELS[category as DeficitFactorCategory] ?? "要因を分類できません";
}
