import { assertRequiredHeaders, parseCsv, toRecords } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { parseJapaneseAmount, normalizeKey } from "./numberUtils";

/** 列順が変わっても取り込めるよう、名前で検証する必須列。 */
const REQUIRED_HEADERS = ["社員No", ["氏　名", "氏名"], "総支給額", "社保合計"] as const;

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

/**
 * 給与集計表には車種・営業所ごとの小計行と総合計行が混ざっている
 * (氏名欄が「[１１ｔ]35名」「[津山（月給）]9名」「[総合計]98名」の形)。
 * これを1名分のレコードとして取り込むと、社員コードがたまたま一致した車両に
 * 数百万〜数千万円の給与が乗ってしまうため、氏名の形で除外する。
 */
function isSubtotalRow(employeeName: string): boolean {
  return /^\[.*\]\s*\d+名$/.test(employeeName.trim());
}

export function parsePayrollCsv(input: string | ArrayBuffer | Uint8Array): PayrollRecord[] {
  const text = typeof input === "string" ? input : decodeCp932(input);
  const rows = parseCsv(text);
  assertRequiredHeaders(rows, REQUIRED_HEADERS, "給与集計表");
  const records = toRecords(rows);

  return records
    .filter((r) => (r["社員No"] ?? "").trim() !== "")
    .filter((r) => !isSubtotalRow(r["氏　名"] ?? r["氏名"] ?? ""))
    .map((r) => ({
      employeeCode: normalizeKey(r["社員No"]),
      employeeName: (r["氏　名"] ?? r["氏名"] ?? "").trim(),
      totalPay: parseJapaneseAmount(r["総支給額"]),
      socialInsuranceTotal: parseJapaneseAmount(r["社保合計"]),
    }));
}
