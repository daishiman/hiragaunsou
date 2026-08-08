import type { SOURCE_TYPES } from "../db/schema";
import { parseCsv } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { isXlsx } from "./detectYearMonth";

export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * 種別判定用に見出し行だけを取り出す。
 * 見出し行の判定にファイル全文は不要なので、先頭64KB(90列程度の見出し行が
 * 収まるのに十分な余裕)だけをデコード・パースする。実データのCSVは数百KB〜数MBあり、
 * 全文をここで一度パースしたうえで各UseCaseがもう一度全文をパースする二重コストは、
 * ファイルサイズに比例してCloudflare WorkersのCPU時間上限(無料プランは既定10ms)を
 * 圧迫する要因になっていた。
 */
function extractHeaderChunk(content: ArrayBuffer, maxBytes = 64 * 1024): ArrayBuffer {
  const bytes = new Uint8Array(content);
  const limit = Math.min(bytes.length, maxBytes);
  const newline = bytes.subarray(0, limit).indexOf(0x0a);
  return content.slice(0, newline >= 0 ? newline + 1 : limit);
}

/** CSVは列見出し、Excelはファイル形式(ZIP)で判定する。ファイル名だけには依存しない。 */
export function resolveSourceTypeFromContent(
  fileName: string,
  content: ArrayBuffer,
): SourceType | "unknown" {
  if (isXlsx(content)) return "monthly_pl_workbook";
  const rows = parseCsv(decodeCp932(extractHeaderChunk(content)));
  return detectFileType(fileName, rows[0] ?? []);
}

/**
 * ファイル種別を自動判定する。**判定の根拠は列構成だけで、ファイル名は一切使わない。**
 *
 * 社内のファイル名は月ごと・将来ともに変わる (実データの "5給与集計表(日給者).csv" の先頭の
 * "5" は月、"車両別運行実績表(燃費計算)本社.csv" の末尾は営業所名)。名前を手がかりにすると、
 * 中身が別物の改名ファイルを取り違えて取り込む。逆に列構成は出力元システムの仕様なので安定している。
 * 判定に使う列は docs/product/data-flow-map.md §6 と対応させる。
 *
 * fileName は受け取るが判定には使わない。呼び出し側のシグネチャを揃えるためだけに残している。
 */
export function detectFileType(
  _fileName: string,
  header: string[],
): SourceType | "unknown" {
  return detectByHeader(header);
}

function detectByHeader(header: string[]): SourceType | "unknown" {
  const set = new Set(header.map((h) => h.replace(/^\uFEFF/, "").normalize("NFKC").trim()));
  const hasAll = (cols: string[]) => cols.every((c) => set.has(c));

  if (hasAll(["車両番号", "稼動時間", "総距離"])) return "vehicle_operation";
  if (hasAll(["車両コード", "受取運賃", "通行料"])) return "sales_monitor";
  if (hasAll(["社員No", "総支給額"])) return "payroll";
  return "unknown";
}
