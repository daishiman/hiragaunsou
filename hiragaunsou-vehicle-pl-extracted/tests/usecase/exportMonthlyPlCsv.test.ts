import { describe, expect, it } from "vitest";
import {
  buildMonthlyPlCsv,
  monthlyPlCsvFileName,
} from "../../src/usecase/steps/exportMonthlyPlCsv";
import { VEHICLE_PL_FIELDS } from "../../src/domain/entities/VehiclePl";

describe("buildMonthlyPlCsv (業務フロー STEP8 転記の代替)", () => {
  it("収支表51列を定義どおりの並びで見出しに出す", () => {
    const csv = buildMonthlyPlCsv([]);
    const header = csv.replace(/^\uFEFF/, "").split("\r\n")[0];
    expect(header?.split(",")).toEqual([...VEHICLE_PL_FIELDS]);
  });

  it("日本語の見出しを渡せば置き換える", () => {
    const csv = buildMonthlyPlCsv([], { no: "車番", profit: "損益" });
    const header = csv.replace(/^\uFEFF/, "").split("\r\n")[0]!;
    expect(header.startsWith("車番,")).toBe(true);
    expect(header).toContain("損益");
  });

  it("Excelで文字化けしないようBOMを付け、改行はCRLFにする", () => {
    const csv = buildMonthlyPlCsv([{ vehicleNo: "24", values: { no: "24" } }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n").filter((l) => l !== "")).toHaveLength(2);
  });

  it("値が無い列は空欄にする(0で埋めて実績と紛らわしくしない)", () => {
    const csv = buildMonthlyPlCsv([{ vehicleNo: "24", values: { no: "24", profit: null } }]);
    const row = csv.replace(/^\uFEFF/, "").split("\r\n")[1]!;
    expect(row.split(",")[0]).toBe("24");
    expect(row.split(",")).toHaveLength(VEHICLE_PL_FIELDS.length);
  });

  it("カンマや引用符を含む値は引用符で囲む", () => {
    const csv = buildMonthlyPlCsv([
      { vehicleNo: "24", values: { driver: "山田, 太郎", type: 'ユニック"大型"' } },
    ]);
    expect(csv).toContain('"山田, 太郎"');
    expect(csv).toContain('"ユニック""大型"""');
  });

  it("0はそのまま0として書き出す(空欄と区別する)", () => {
    const csv = buildMonthlyPlCsv([{ vehicleNo: "24", values: { profit: 0 } }]);
    const cells = csv.replace(/^\uFEFF/, "").split("\r\n")[1]!.split(",");
    expect(cells[VEHICLE_PL_FIELDS.indexOf("profit")]).toBe("0");
  });
});

describe("monthlyPlCsvFileName", () => {
  it("業務で使う言葉のファイル名にする", () => {
    expect(monthlyPlCsvFileName("2026-05")).toBe("車両別収支表_2026年5月.csv");
  });

  it("月の先頭の0は落とす", () => {
    expect(monthlyPlCsvFileName("2026-01")).toBe("車両別収支表_2026年1月.csv");
  });
});
