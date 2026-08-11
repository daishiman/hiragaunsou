/**
 * 表示用フォーマッタ (モック mock/js/core.js の yen / man / pct / num に対応)。
 * Presentation層。金額の丸めルールは画面表示専用で、Domainの計算には使わない。
 */

/** 円 (整数・3桁カンマ)。負値は会計表記の ▲ を付ける。 */
export function yen(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  const abs = Math.abs(rounded).toLocaleString("ja-JP");
  return rounded < 0 ? `▲${abs}` : abs;
}

/** 万円・億円に丸めた概数 (ダッシュボードのタイル等、桁の大きさを掴む用途) */
export function man(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "▲" : "";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(2)}億円`;
  return `${sign}${Math.round(abs / 10_000).toLocaleString("ja-JP")}万円`;
}

/** 比率 (0.1342 → 13.4%) */
export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** 一般の数値 (3桁カンマ・小数桁指定可) */
export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 円/km 単価 */
export function kmPriceLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}円`;
}

/** 2026-05 → 2026年5月 */
export function yearMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}年${Number(m)}月`;
}

/**
 * 記録の日時 (2026/08/11 09:30)。
 *
 * 同じ画面の中で formatDateTime() と toLocaleString("ja-JP") が混ざり、
 * 秒のある表記と無い表記が並んでいた。日時の書き方はここ1箇所だけが持つ。
 */
export function dateTimeLabel(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 推移グラフの目盛りラベル。「8月」だけだと複数年にまたがる期間で年が分からなくなるため、
 * 先頭の点と年が変わる1月だけ年を添える (毎回付けると目盛りが読みにくくなる)。
 */
export function chartMonthLabel(yearMonth: string, index: number): string {
  const [y, m] = yearMonth.split("-");
  const month = Number(m);
  if (index === 0 || month === 1) return `${y}/${month}月`;
  return `${month}月`;
}
