import { describe, expect, it } from "vitest";
import Encoding from "encoding-japanese";
import { detectYearMonth } from "../../src/infrastructure/parsers/detectYearMonth";
import { buildMonthlyPlWorkbookFixture } from "../fixtures/monthlyPlWorkbook";

/**
 * 「このファイルは何年何月分か」を**中身だけ**から判定できるか。
 *
 * 列構成は実データ (2026年5月分) を開いて確認したものに合わせている。
 *   - 売上モニタリスト: 積荷日・計上日・請求日などの日付列を持つ。請求日だけ翌月にずれる行がある
 *     (実測 2104件中104件が2026-06)。
 *   - 給与集計表(日給者) / 車両別運行実績表(燃費計算): 日付列が1つも無い。中身から年月は決まらない。
 *   - ★車両別収支計算用: シート名は「5月収支表」で年が無く、年月はシート1行目の
 *     「令和8年 5 月車両別収支表」から復元する。
 */
function csv(text: string): ArrayBuffer {
  const bytes = new Uint8Array(
    Encoding.convert(Encoding.stringToCode(text), { to: "SJIS", from: "UNICODE" }),
  );
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("detectYearMonth", () => {
  it("日付列を持つCSVは、その最頻値から年月を判定し根拠を返す", () => {
    const result = detectYearMonth(
      csv(
        [
          "車両コード,積荷日,計上日,請求日,受取運賃",
          "101,2026/05/01,2026/05/01,2026/05/31,10000",
          "102,2026/05/20,2026/05/20,2026/05/31,20000",
          "103,2026/05/31,2026/05/31,2026/06/30,30000",
        ].join("\r\n"),
      ),
    );
    expect(result.yearMonth).toBe("2026-05");
    expect(result.basis).toContain("計上日");
    expect(result.basis).toContain("2026年5月");
  });

  it("翌月にずれる請求日ではなく、計上日を年月の根拠にする", () => {
    // 実データでは請求日だけが翌月に食い込む。列の並び順(請求日が先)に左右されないこと。
    const result = detectYearMonth(
      csv(
        [
          "請求日,計上日",
          "2026/06/30,2026/05/01",
          "2026/06/30,2026/05/02",
          "2026/06/30,2026/05/03",
        ].join("\r\n"),
      ),
    );
    expect(result.yearMonth).toBe("2026-05");
    expect(result.basis).toContain("計上日");
  });

  it("日付列が1つも無い帳票は判定せず、利用者に選んでもらう案内を返す", () => {
    // 給与集計表(日給者)の実際の列構成。日付・年月を示す値がどこにも無い。
    const result = detectYearMonth(
      csv(
        [
          "社員No,氏　名,扶養親族等,出勤日数,総支給額",
          "658,平賀 太郎,1,21,350000",
          "720,平賀 次郎,0,20,320000",
        ].join("\r\n"),
      ),
    );
    expect(result.yearMonth).toBeNull();
    expect(result.basis).toContain("日付が書かれていない");
  });

  it("車両別運行実績表も日付を持たないため判定できない", () => {
    const result = detectYearMonth(
      csv(
        [
          "項,車両番号,車両名称,稼動回数,稼動時間,総距離",
          "1,101,4tユニック,20,180:00:00,5000",
          "2,102,10t平,18,160:00:00,4800",
        ].join("\r\n"),
      ),
    );
    expect(result.yearMonth).toBeNull();
  });

  it("Excelはシート名ではなく、収支表の見出しに書かれた和暦から年月を判定する", () => {
    // シート名「5月収支表」には年が無い。年は見出し「令和8年5月車両別収支表」にしかない。
    const workbook = buildMonthlyPlWorkbookFixture({
      sheetName: "5月収支表",
      heading: "令和8年5月車両別収支表",
    });
    const result = detectYearMonth(toArrayBuffer(workbook));
    expect(result.yearMonth).toBe("2026-05");
    expect(result.basis).toContain("5月収支表");
    expect(result.basis).toContain("2026年5月");
  });

  it("見出しに和暦が無いExcelは判定せず、利用者に選んでもらう", () => {
    const workbook = buildMonthlyPlWorkbookFixture({ sheetName: "収支表", heading: "車両別収支表" });
    const result = detectYearMonth(toArrayBuffer(workbook));
    expect(result.yearMonth).toBeNull();
    expect(result.basis).toContain("選んでください");
  });

  it("読み取れないファイルでも例外にせず、利用者に選んでもらう案内を返す", () => {
    const result = detectYearMonth(new ArrayBuffer(0));
    expect(result.yearMonth).toBeNull();
    expect(result.basis).toContain("選んでください");
  });
});
