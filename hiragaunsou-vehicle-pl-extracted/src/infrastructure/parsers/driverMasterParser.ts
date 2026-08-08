import { assertRequiredHeaders, parseCsv, toRecords } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { normalizeKey } from "./numberUtils";

/**
 * 運転者マスタ CSV パーサ (社員コード ↔ 車番の対応表)。
 *
 * 給与集計表は社員コード単位、収支表は車番単位で、両者を結ぶ表はこれしかない。
 * ここが空だと、給与集計表を正しく取り込んでも収支表の人件費は全車両0のままになる
 * (画面には「稼働しているのに給与が0です」として出る)。
 *
 * 列順が変わっても取り込めるよう、名前で検証する。氏名は給与集計表と同じく
 * 全角スペース入りの「氏　名」で出力されることがあるため両方を受ける。
 */
const REQUIRED_HEADERS = ["社員No", ["氏　名", "氏名"], "車番"] as const;

export interface DriverMasterImportRow {
  employeeCode: string;
  driverName: string;
  /** 未割当(退職・内勤等)は null。収支表側では給与が乗らないだけで、エラーにはしない。 */
  vehicleNo: string | null;
}

export interface DriverMasterImportRowError {
  /** ヘッダー行を1行目として数えたCSV上の行番号 */
  rowNumber: number;
  employeeCode: string;
  reason: string;
}

/**
 * 例外ではなく { valid, errors } を返すのは車両マスタと同じ理由で、
 * 1行の不備で全体の取込を止めると実務では毎回やり直しになるため。
 */
export function parseDriverMasterCsv(input: string | ArrayBuffer | Uint8Array): {
  valid: DriverMasterImportRow[];
  errors: DriverMasterImportRowError[];
} {
  const text = typeof input === "string" ? input : decodeCp932(input);
  const rows = parseCsv(text);
  assertRequiredHeaders(rows, REQUIRED_HEADERS, "運転者マスタ");
  const records = toRecords(rows);

  const valid: DriverMasterImportRow[] = [];
  const errors: DriverMasterImportRowError[] = [];
  const seen = new Map<string, number>();

  records.forEach((r, index) => {
    const rowNumber = index + 2;
    // 社員コードは給与集計表と同じ正規化(先頭ゼロ除去)をかける。
    // ここが揃っていないと給与の突合が静かに外れる。
    const employeeCode = normalizeKey(r["社員No"]);
    if (employeeCode === "") return; // 合計行・空行は読み飛ばす

    const driverName = (r["氏　名"] ?? r["氏名"] ?? "").trim();
    if (driverName === "") {
      errors.push({ rowNumber, employeeCode, reason: "氏名が空です" });
      return;
    }

    // 社員コードは主キー。重複を黙って後勝ちにすると、どちらの車番が採用されたか
    // 誰にも分からないまま人件費が別の車に乗る。
    const duplicated = seen.get(employeeCode);
    if (duplicated !== undefined) {
      errors.push({
        rowNumber,
        employeeCode,
        reason: `社員コードが${duplicated}行目と重複しています`,
      });
      return;
    }
    seen.set(employeeCode, rowNumber);

    const vehicleNo = normalizeKey(r["車番"]);
    valid.push({ employeeCode, driverName, vehicleNo: vehicleNo === "" ? null : vehicleNo });
  });

  return { valid, errors };
}
