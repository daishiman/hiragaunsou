import type { SOURCE_TYPES } from "../db/schema";

export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * ファイル名の完全一致に依存せず、接頭辞・接尾辞・キーワードとカラム構成でファイル種別を自動判定する。
 * ファイル名は月替わりで変化する前提 (例: "車両別運行実績表(燃費計算)本社.csv" は営業所名部分が変わり得る)。
 */
export function detectFileType(
  fileName: string,
  header: string[],
): SourceType | "unknown" {
  const byName = detectByFileName(fileName);
  if (byName !== "unknown") return byName;
  return detectByHeader(header);
}

function detectByFileName(fileName: string): SourceType | "unknown" {
  if (fileName.includes("運行実績表")) return "vehicle_operation";
  if (fileName.includes("売上モニタリスト")) return "sales_monitor";
  if (fileName.includes("給与集計表")) return "payroll";
  return "unknown";
}

function detectByHeader(header: string[]): SourceType | "unknown" {
  const set = new Set(header.map((h) => h.trim()));
  const hasAll = (cols: string[]) => cols.every((c) => set.has(c));

  if (hasAll(["車両番号", "稼動時間", "総距離"])) return "vehicle_operation";
  if (hasAll(["車両コード", "受取運賃", "通行料"])) return "sales_monitor";
  if (hasAll(["社員No", "総支給額"])) return "payroll";
  return "unknown";
}
