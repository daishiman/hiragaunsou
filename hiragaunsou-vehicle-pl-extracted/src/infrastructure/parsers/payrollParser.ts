import { parseCsv, toRecords } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { parseJapaneseAmount, normalizeKey } from "./numberUtils";

/**
 * 給与集計表(日給者) (ACELINK NX-CE出力, cp932/shift_jis, 59列) パーサ。
 *
 * 金額列はカンマ区切り右詰め文字列 (例 "663,820") のため数値変換必須。
 * ヘッダーに「総支給額」「社保合計」等の列が複数ブロックに重複して現れるが、
 * `toRecords` はヘッダー名でオブジェクト化するため後勝ち(最終ブロック=支給合計)で自然に解決される。
 * 社員No(社員コード)で紐づけ、車番とは別キーである点に注意 (1:1対応しない)。
 */
export interface PayrollRecord {
  employeeCode: string;
  employeeName: string;
  /** 総支給額 (賞与・福利厚生の連鎖計算の元になる給与本体) */
  totalPay: number;
  /** 社保合計額 (福利厚生費の自動算出元) */
  socialInsuranceTotal: number;
}

export function parsePayrollCsv(input: string | ArrayBuffer | Uint8Array): PayrollRecord[] {
  const text = typeof input === "string" ? input : decodeCp932(input);
  const rows = parseCsv(text);
  const records = toRecords(rows);

  return records
    .filter((r) => (r["社員No"] ?? "").trim() !== "")
    .map((r) => ({
      employeeCode: normalizeKey(r["社員No"]),
      employeeName: (r["氏　名"] ?? r["氏名"] ?? "").trim(),
      totalPay: parseJapaneseAmount(r["総支給額"]),
      socialInsuranceTotal: parseJapaneseAmount(r["社保合計"]),
    }));
}
