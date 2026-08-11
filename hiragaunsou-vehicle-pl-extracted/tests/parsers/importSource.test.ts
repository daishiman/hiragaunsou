import { describe, expect, it } from "vitest";
import { describeImportSource } from "../../src/infrastructure/parsers/importSource";

/**
 * 「取り込んだのに数字が思っていたのと違う」と言われたとき、画面のこの一文だけで
 * 原因(別の月のシートを読んでいた)にたどり着けることを守る。
 */
describe("describeImportSource", () => {
  it("読んだシートと、その見出しから判定した年月を続けて示す", () => {
    expect(
      describeImportSource({ kind: "excel", sheetName: "5月収支表", sheetYearMonth: "2026-05" }),
    ).toBe("シート「5月収支表」の見出しから2026年5月分と判定し、そこから読み取りました。");
  });

  it("見出しから年月が読めなかったときは、シート名だけを示す", () => {
    expect(describeImportSource({ kind: "excel", sheetName: "収支表", sheetYearMonth: null })).toBe(
      "シート「収支表」から読み取りました。",
    );
  });

  it("対象月のシートが無く代用したときは、その事実と画面ごとの補足を添える", () => {
    const text = describeImportSource(
      {
        kind: "excel",
        sheetName: "5月収支表",
        sheetYearMonth: "2026-05",
        fallbackFromYearMonth: "2026-07",
      },
      { fallbackNote: "車両の金額は月をまたいでも変わりません。" },
    );
    expect(text).toContain("対象年月 2026年7月 のシートがこのExcelに無かったため");
    expect(text).toContain("いちばん新しいシート「5月収支表」の見出しから2026年5月分と判定し");
    expect(text).toContain("車両の金額は月をまたいでも変わりません。");
  });

  it("CSV取込は読み取り元をそのまま伝える", () => {
    expect(describeImportSource({ kind: "csv" })).toBe("CSVから読み取りました。");
  });

  it("出所が分からないときは何も表示しない", () => {
    expect(describeImportSource(undefined)).toBeNull();
  });
});
