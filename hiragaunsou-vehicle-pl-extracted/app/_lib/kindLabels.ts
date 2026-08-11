/**
 * 内部のキーを画面の言葉に訳す表。
 *
 * ここに無いキーはそのまま出さず、キーを見せてよいか判断してから足す。
 * 画面に英語のキーを出さない (docs/product/T7-ui-conventions.md §1-3)。
 */

/** AIの呼び出し種別 (usage_log.kind)。定義元は各 usecase の USAGE_KIND。 */
const USAGE_KIND_LABELS: Record<string, string> = {
  deficit_factor_analysis: "赤字の要因分析",
  factor_analysis_report: "要因分析のレポート",
};

export function usageKindLabel(kind: string): string {
  return USAGE_KIND_LABELS[kind] ?? kind;
}

/**
 * 取り込んだ帳票の種類 (import_batch.sourceType)。
 * 呼び方は「帳票の種類」で統一する (T7 §1-1)。
 */
const SOURCE_TYPE_LABELS: Record<string, string> = {
  vehicle_operation: "車両別運行実績表",
  sales_monitor: "売上モニタリスト",
  payroll: "給与集計表（日給者）",
  monthly_pl_workbook: "★車両別収支計算用",
  manual_entry: "手入力",
  unknown: "判別できない帳票",
};

export function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType;
}
