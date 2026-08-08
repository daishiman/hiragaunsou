import type { HeaderRequirement } from "./csvUtils";
import { findMissingHeaders, parseCsv } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { isXlsx } from "./detectYearMonth";
import { REQUIRED_HEADERS as DRIVER_MASTER_HEADERS } from "./driverMasterParser";
import { REQUIRED_HEADERS as PAYROLL_HEADERS } from "./payrollParser";
import { REQUIRED_HEADERS as SALES_MONITOR_HEADERS } from "./salesMonitorParser";
import { REQUIRED_HEADERS as VEHICLE_MASTER_HEADERS } from "./vehicleMasterParser";
import { REQUIRED_HEADERS as VEHICLE_OPERATION_HEADERS } from "./vehicleOperationParser";

/**
 * 「この取込口には、この列が要る」の一覧。
 *
 * これまで足りない列は取込を実行してはじめてエラーになっていた。取込前の下読みで
 * 同じ判定を先にかけ、足りない列名を具体的に画面へ出すために、各パーサの必須列を
 * ここに集約する(パーサ側の定義をそのまま参照するので二重管理にならない)。
 */
const REQUIREMENTS: Record<string, readonly HeaderRequirement[]> = {
  vehicle_operation: VEHICLE_OPERATION_HEADERS,
  sales_monitor: SALES_MONITOR_HEADERS,
  payroll: PAYROLL_HEADERS,
  vehicle_master: VEHICLE_MASTER_HEADERS,
  driver_master: DRIVER_MASTER_HEADERS,
};

/**
 * 中身を読んで、足りない必須列の名前を返す。
 *
 * Excel(収支表シート)は列見出しの位置が固定ではなく、パーサ側が見出しを探して解決するため、
 * ここでは判定しない(足りなければ取込本体が理由つきで返す)。CSVだけを対象にする。
 */
export function findMissingColumns(target: string, content: ArrayBuffer): string[] {
  const requirements = REQUIREMENTS[target];
  if (!requirements) return [];
  if (isXlsx(content)) return [];
  let header: string[] = [];
  try {
    header = parseCsv(decodeCp932(content))[0] ?? [];
  } catch {
    return [];
  }
  if (header.length === 0) return [];
  // 先頭列にBOM(U+FEFF)が残ると「車番」が別の文字列として扱われ、あるのに無いと言ってしまう。
  return findMissingHeaders(
    header.map((h) => h.replace(/^\uFEFF/, "")),
    requirements,
  );
}
