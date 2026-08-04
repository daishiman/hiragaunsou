import { VEHICLE_PL_FIELDS, type VehiclePlField } from "../../domain/entities/VehiclePl";

/**
 * 業務フロー STEP8「運送収支表への転記(完成)」の代替。
 *
 * docx では『★運送収支表2025-2026_5月更新』に手で貼り付けているが、
 * この転記は人がやる価値のない作業なので、収支表をそのまま Excel で開ける CSV として書き出す。
 * 列の順番・意味は収支表51列(VEHICLE_PL_FIELDS)と完全に同じにして、
 * 貼り付け先のフォーマットを崩さない。
 */

/** Excel が文字化けせず開けるよう BOM 付き・CRLF 改行にする */
const BOM = "﻿";
const CRLF = "\r\n";

function escapeCsvValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "") return "";
  // カンマ・引用符・改行を含む値は引用符で囲み、内部の引用符は2重にする (RFC 4180)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface MonthlyPlCsvRow {
  vehicleNo: string;
  values: Partial<Record<VehiclePlField, number | string | null>>;
}

/**
 * 収支表51列をCSV文字列にする。
 * labels は日本語見出し (Presentation層の FIELD_LABELS を渡す)。
 * 見出しを渡さなかった列は英語のフィールド名をそのまま使う。
 */
export function buildMonthlyPlCsv(
  rows: readonly MonthlyPlCsvRow[],
  labels: Partial<Record<VehiclePlField, string>> = {},
): string {
  const header = VEHICLE_PL_FIELDS.map((f) => escapeCsvValue(labels[f] ?? f)).join(",");
  const body = rows.map((row) =>
    VEHICLE_PL_FIELDS.map((f) => escapeCsvValue(row.values[f] ?? null)).join(","),
  );
  return BOM + [header, ...body].join(CRLF) + CRLF;
}

/** ダウンロード時のファイル名 (業務で使う言葉に合わせる) */
export function monthlyPlCsvFileName(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `車両別収支表_${y}年${Number(m)}月.csv`;
}
