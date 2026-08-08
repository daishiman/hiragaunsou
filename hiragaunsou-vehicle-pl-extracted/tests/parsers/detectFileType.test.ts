import { describe, expect, it } from "vitest";
import { detectFileType } from "../../src/infrastructure/parsers/detectFileType";

describe("detectFileType", () => {
  it("ファイル名と中身が食い違うときは中身(列構成)を優先する", () => {
    // 社内のファイル名は毎月・年度ごとに変わり、使い回しの改名も起きる。名前を先に信じると
    // 「給与集計表という名前の売上モニタリスト」を給与として取り込んで静かにデータを汚す。
    expect(
      detectFileType("5給与集計表(日給者).csv", ["車両コード", "受取運賃", "通行料"]),
    ).toBe("sales_monitor");
    expect(
      detectFileType("2026年5月売上モニタリスト.csv", ["社員No", "総支給額"]),
    ).toBe("payroll");
  });

  it("列見出しが読めないときだけファイル名のキーワードで判定する(営業所名部分が変わっても検出できる)", () => {
    expect(
      detectFileType("車両別運行実績表(燃費計算)本社.csv", []),
    ).toBe("vehicle_operation");
    expect(detectFileType("車両別運行実績表(燃費計算)津山.csv", [])).toBe(
      "vehicle_operation",
    );
    expect(detectFileType("2026年5月売上モニタリスト.csv", [])).toBe(
      "sales_monitor",
    );
    expect(detectFileType("5給与集計表(日給者).csv", [])).toBe("payroll");
    expect(detectFileType("6給与集計表(日給者).csv", [])).toBe("payroll");
  });

  it("ファイル名に手がかりが無くてもカラム構成から判定する", () => {
    expect(
      detectFileType("unknown.csv", ["車両番号", "稼動時間", "総距離"]),
    ).toBe("vehicle_operation");
    expect(
      detectFileType("unknown.csv", ["車両コード", "受取運賃", "通行料"]),
    ).toBe("sales_monitor");
    expect(detectFileType("unknown.csv", ["社員No", "総支給額"])).toBe(
      "payroll",
    );
  });

  it("どちらでも判定できない場合はunknownを返す", () => {
    expect(detectFileType("random.csv", ["foo", "bar"])).toBe("unknown");
  });
});
