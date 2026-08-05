import { describe, expect, it } from "vitest";
import { detectDominantYearMonth, type SalesMonitorRow } from "../../src/infrastructure/parsers/salesMonitorParser";

/**
 * 取込画面の「対象年月とファイルの中身が食い違っていないか」チェック(取込確定前の確認)向け。
 * 既存の parseSalesMonitorCsv 系テストとは別ファイルにして、既存テストには手を入れない。
 */
function row(overrides: Partial<SalesMonitorRow> = {}): SalesMonitorRow {
  return {
    vehicleCode: "101",
    driverName: "山田",
    fare: 10000,
    toll: 0,
    ancillaryFee: 0,
    isChartered: false,
    needsReview: false,
    reviewReason: null,
    slipNo: "S1",
    lineNo: "1",
    customerName: "テスト",
    loadDate: "2026-07-01",
    ...overrides,
  };
}

describe("detectDominantYearMonth", () => {
  it("積荷日の年月を多数決で判定する", () => {
    const rows = [
      row({ loadDate: "2026/07/01" }),
      row({ loadDate: "2026/07/15" }),
      row({ loadDate: "2026/06/30" }),
    ];
    const result = detectDominantYearMonth(rows);
    expect(result).toEqual({ dominantYearMonth: "2026-07", matchedRows: 3, dominantCount: 2 });
  });

  it("積荷日を1件も読み取れない場合はnull", () => {
    const rows = [row({ loadDate: "" }), row({ loadDate: "不明" })];
    const result = detectDominantYearMonth(rows);
    expect(result).toEqual({ dominantYearMonth: null, matchedRows: 0, dominantCount: 0 });
  });

  it("行が無い場合もnull", () => {
    expect(detectDominantYearMonth([])).toEqual({
      dominantYearMonth: null,
      matchedRows: 0,
      dominantCount: 0,
    });
  });
});
