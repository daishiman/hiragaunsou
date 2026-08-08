import type { SOURCE_TYPES } from "../db/schema";

export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * ファイル種別を自動判定する。**列構成を先に見て、ファイル名は最後の手がかりにしか使わない。**
 *
 * 社内のファイル名は月ごと・将来ともに変わる (実データの "5給与集計表(日給者).csv" の先頭の
 * "5" は月、"車両別運行実績表(燃費計算)本社.csv" の末尾は営業所名)。名前を先に信じると、
 * 中身が別物の改名ファイルを取り違えて取り込む。逆に列構成は出力元システムの仕様なので安定している。
 * 判定に使う列は docs/product/data-flow-map.md §6 と対応させる。
 */
export function detectFileType(
  fileName: string,
  header: string[],
): SourceType | "unknown" {
  const byHeader = detectByHeader(header);
  if (byHeader !== "unknown") return byHeader;
  return detectByFileName(fileName);
}

/** 列見出しが読めなかった (壊れたCSV・空ファイル) ときだけの保険。 */
function detectByFileName(fileName: string): SourceType | "unknown" {
  const normalized = fileName.normalize("NFKC");
  if (normalized.includes("運行実績表")) return "vehicle_operation";
  if (normalized.includes("売上モニタリスト")) return "sales_monitor";
  if (normalized.includes("給与集計表")) return "payroll";
  return "unknown";
}

function detectByHeader(header: string[]): SourceType | "unknown" {
  const set = new Set(header.map((h) => h.replace(/^\uFEFF/, "").normalize("NFKC").trim()));
  const hasAll = (cols: string[]) => cols.every((c) => set.has(c));

  if (hasAll(["車両番号", "稼動時間", "総距離"])) return "vehicle_operation";
  if (hasAll(["車両コード", "受取運賃", "通行料"])) return "sales_monitor";
  if (hasAll(["社員No", "総支給額"])) return "payroll";
  return "unknown";
}
