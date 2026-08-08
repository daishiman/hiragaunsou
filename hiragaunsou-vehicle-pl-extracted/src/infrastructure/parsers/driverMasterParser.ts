import { assertRequiredHeaders, parseCsv, toRecords } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { normalizeKey, splitCompositeVehicleNo } from "./numberUtils";
import { parseMonthlyPlWorkbook } from "./monthlyPlWorkbookParser";
import type { ImportSourceInfo } from "./importSource";

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
export const REQUIRED_HEADERS = ["社員No", ["氏　名", "氏名"], "車番"] as const;

export interface DriverMasterImportRow {
  employeeCode: string;
  driverName: string;
  /** 未割当(退職・内勤等)は null。収支表側では給与が乗らないだけで、エラーにはしない。 */
  vehicleNo: string | null;
}

export interface DriverMasterImportRowError {
  /** ヘッダー行を1行目として数えた取込元ファイル上の行番号 */
  rowNumber: number;
  employeeCode: string;
  reason: string;
}

export interface DriverMasterParseResult {
  valid: DriverMasterImportRow[];
  errors: DriverMasterImportRowError[];
  /** 元データのどこを読んだか (画面に出して人が確かめられるようにする) */
  source?: ImportSourceInfo;
}

/**
 * CSVとExcelの共通の中間表現。取込元が何であれ「1行 = 社員No・氏名・車番」に揃えてから
 * 同じ検証(空欄・重複)にかける。検証を経路ごとに書くと、CSVでは通る人がExcelでは
 * 弾かれる等のズレが出る (車両マスタと同じ設計)。
 */
interface DriverMasterSourceRow {
  rowNumber: number;
  employeeCode: string;
  driverName: string;
  vehicleNo: string;
}

/**
 * 例外ではなく { valid, errors } を返すのは車両マスタと同じ理由で、
 * 1行の不備で全体の取込を止めると実務では毎回やり直しになるため。
 */
function classifySourceRows(sources: readonly DriverMasterSourceRow[]): DriverMasterParseResult {
  const valid: DriverMasterImportRow[] = [];
  const errors: DriverMasterImportRowError[] = [];
  const seen = new Map<string, number>();

  for (const source of sources) {
    if (source.employeeCode === "") continue; // 合計行・空行は読み飛ばす

    if (source.driverName === "") {
      errors.push({ rowNumber: source.rowNumber, employeeCode: source.employeeCode, reason: "氏名が空です" });
      continue;
    }

    // 社員コードは主キー。重複を黙って後勝ちにすると、どちらの車番が採用されたか
    // 誰にも分からないまま人件費が別の車に乗る。
    const duplicated = seen.get(source.employeeCode);
    if (duplicated !== undefined) {
      errors.push({
        rowNumber: source.rowNumber,
        employeeCode: source.employeeCode,
        reason: `社員Noが${duplicated}行目と重複しています(同じ社員Noを2つの車番に割り当てられません)`,
      });
      continue;
    }
    seen.set(source.employeeCode, source.rowNumber);

    valid.push({
      employeeCode: source.employeeCode,
      driverName: source.driverName,
      vehicleNo: source.vehicleNo === "" ? null : source.vehicleNo,
    });
  }

  return { valid, errors };
}

/** xlsx (ZIP) の先頭4バイト。拡張子でもMIMEでもなく中身で判定する (車両マスタと同じ)。 */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function isXlsx(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * 運転者マスタの取込口。Excel (.xlsx) とCSVのどちらを渡されても受け付ける。
 *
 * 車両マスタと同じく、拡張子やMIMEタイプではなく中身の先頭バイトで振り分ける。
 * ブラウザの accept 属性は選択ダイアログの初期フィルタでしかなく、
 * 「すべてのファイル」を選べばxlsxがそのまま飛んでくる。
 */
export function parseDriverMasterFile(
  input: ArrayBuffer | Uint8Array,
  preferredYearMonth?: string,
): DriverMasterParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return isXlsx(bytes)
    ? parseDriverMasterWorkbook(bytes, preferredYearMonth)
    : parseDriverMasterCsv(bytes);
}

/**
 * 社内Excel「★車両別収支計算用」の収支表シートから、運転者マスタを直接取り込む。
 *
 * 収支表シートは車両1行につき「コード」(社員No)・「運転者名」・「車番」を持っており、
 * 運転者マスタが必要とする3項目はこの3列がそのまま元データになる
 * (収支表の指摘表示でも code を「社員コード」、driver を「運転者名」として扱っている)。
 * CSVに書き出す手作業を挟まないぶん、書き出し漏れ・列並べ替え・文字コード事故が起きない。
 *
 * 車両マスタと同じExcelを同じ手順で選べるようにするのが目的なので、シートの検出と
 * 列の名前解決は月次収支表の取込 (parseMonthlyPlWorkbook) と同じ実装を使う。
 */
export function parseDriverMasterWorkbook(
  input: ArrayBuffer | Uint8Array,
  preferredYearMonth?: string,
): DriverMasterParseResult {
  // 社員Noと車番の対応は月ごとの実績ではなく人事の状態なので、対象年月のシートが
  // 無くてもいちばん新しい月で代用してよい (車両マスタと同じ扱い)。
  const { rows, sheetName, sheetYearMonth } = parseMonthlyPlWorkbook(
    input,
    preferredYearMonth,
    "useLatest",
  );

  const sources: DriverMasterSourceRow[] = [];
  const errors: DriverMasterImportRowError[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // 見出し行を1行目として数える (CSV経路と合わせる)
    const driverName = (row.driver ?? "").trim();

    // 収支表の車番は「129 1113」のようにけん引の組を1セルにまとめた表記がある。
    // 運転者が乗るのは自走するトラクタなので、先頭の車番に割り当てる。
    const vehicleNo = splitCompositeVehicleNo(row.no)[0] ?? "";

    const codes = splitEmployeeCodes(row.code);
    if (codes.length === 0) {
      // 傭車(車番88888)・諸口はそもそも自社の運転者ではないので、指摘せず読み飛ばす。
      if (driverName === "" || isNonEmployeeRow(driverName, vehicleNo)) return;
      errors.push({
        rowNumber,
        employeeCode: "",
        reason: `車番${vehicleNo || "(空欄)"}の運転者「${driverName}」に社員Noが入っていません。Excelの「コード」列を埋めてから取り込んでください`,
      });
      return;
    }

    // 2人乗務の車両は「コード」「運転者名」が同じ区切りで複数書かれる。人数が合わない場合は
    // どの社員Noがどの氏名か決められないため、勝手に組まずに指摘して人に直してもらう
    // (取り違えると、その人の給与がまるごと別の車に乗る)。
    const names = splitDriverNames(driverName);
    if (codes.length > 1 && names.length !== codes.length) {
      errors.push({
        rowNumber,
        employeeCode: codes.join("/"),
        reason: `社員Noが${codes.length}件、運転者名が${names.length}件で数が合いません(「${driverName}」)。同じ区切りで同じ人数を書いてください`,
      });
      return;
    }

    codes.forEach((employeeCode, i) => {
      sources.push({
        rowNumber,
        employeeCode,
        driverName: (names[i] ?? names[0] ?? "").trim(),
        vehicleNo,
      });
    });
  });

  const result = classifySourceRows(sources);
  return {
    valid: result.valid,
    errors: [...errors, ...result.errors].sort((a, b) => a.rowNumber - b.rowNumber),
    source: {
      kind: "excel",
      sheetName,
      sheetYearMonth,
      ...(preferredYearMonth && sheetYearMonth !== preferredYearMonth
        ? { fallbackFromYearMonth: preferredYearMonth }
        : {}),
    },
  };
}

/** 「93/94」「93 94」のような複数人表記を社員Noの配列にする。 */
function splitEmployeeCodes(value: string | null | undefined): string[] {
  if (value == null) return [];
  return value
    // \s は全角スペース(U+3000)も含む。
    .split(/[\s/／,、･・]+/)
    .map((part) => normalizeKey(part))
    // 社員Noは数字。「-」等の記号だけのセルを社員Noとして拾わない。
    .filter((part) => /^\d+$/.test(part));
}

/** 「浅沼　秀敏/佐藤　一郎」のような複数人表記を氏名の配列にする(氏名内の全角スペースは残す)。 */
function splitDriverNames(value: string): string[] {
  return value
    .split(/[/／,、･・]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** 傭車(車番88888)・諸口は自社の運転者ではないので、社員Noが無くても指摘しない。 */
function isNonEmployeeRow(driverName: string, vehicleNo: string): boolean {
  return vehicleNo === "88888" || /傭車|諸口/.test(driverName);
}

export function parseDriverMasterCsv(
  input: string | ArrayBuffer | Uint8Array,
): DriverMasterParseResult {
  const text = typeof input === "string" ? input : decodeCp932(input);
  const rows = parseCsv(text);
  assertRequiredHeaders(rows, REQUIRED_HEADERS, "運転者マスタ");

  const sources: DriverMasterSourceRow[] = toRecords(rows).map((r, index) => ({
    rowNumber: index + 2, // ヘッダー行を1行目として数える
    // 社員コードは給与集計表と同じ正規化(先頭ゼロ除去)をかける。
    // ここが揃っていないと給与の突合が静かに外れる。
    employeeCode: normalizeKey(r["社員No"]),
    driverName: (r["氏　名"] ?? r["氏名"] ?? "").trim(),
    vehicleNo: normalizeKey(r["車番"]),
  }));

  return { ...classifySourceRows(sources), source: { kind: "csv" } };
}
