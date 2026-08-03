import { describe, expect, it } from "vitest";
import { detectFileType } from "../../src/server/parsers/detectFileType";

describe("detectFileType", () => {
  it("ファイル名のキーワードで判定する(営業所名部分が変わっても検出できる)", () => {
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

  it("ファイル名で判定できない場合はカラム構成から判定する", () => {
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
