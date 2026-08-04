/**
 * 会計期間 (年度) の扱い。平賀運送の期は 6月始まり〜翌5月締め
 * (モックの months が 2025-06 〜 2026-05 で1期を構成していることに準拠)。
 *
 * Domain層: フレームワーク非依存。
 */

/** 期の開始月 (6月) */
export const FISCAL_START_MONTH = 6;

function parse(yearMonth: string): { year: number; month: number } {
  const [y, m] = yearMonth.split("-");
  return { year: Number(y), month: Number(m) };
}

function format(year: number, monthIndex0: number): string {
  const date = new Date(Date.UTC(year, monthIndex0, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** その年月が属する期の開始年 (例: 2026-05 → 2025) */
export function fiscalYearOf(yearMonth: string): number {
  const { year, month } = parse(yearMonth);
  return month >= FISCAL_START_MONTH ? year : year - 1;
}

/** その年月が属する期の12ヶ月 (6月→翌5月の昇順) */
export function fiscalYearMonths(yearMonth: string): string[] {
  const startYear = fiscalYearOf(yearMonth);
  return Array.from({ length: 12 }, (_, i) => format(startYear, FISCAL_START_MONTH - 1 + i));
}

/** 前期の12ヶ月 (対前年比較用, 昇順) */
export function previousFiscalYearMonths(yearMonth: string): string[] {
  return fiscalYearMonths(format(fiscalYearOf(yearMonth) - 1, FISCAL_START_MONTH - 1));
}

/** 対象月を含む直近 count ヶ月 (昇順)。異常値チェックの12ヶ月推移・実力損益の平均に使う。 */
export function trailingYearMonths(yearMonth: string, count: number): string[] {
  const { year, month } = parse(yearMonth);
  return Array.from({ length: count }, (_, i) => format(year, month - 1 - (count - 1 - i)));
}

/** 同一期内の前年同月 (対前年比較の相手) を返す */
export function sameMonthPreviousYear(yearMonth: string): string {
  const { year, month } = parse(yearMonth);
  return format(year - 1, month - 1);
}

/** 表示用ラベル (例: 2025-06 → 6月) */
export function monthLabel(yearMonth: string): string {
  return `${parse(yearMonth).month}月`;
}
