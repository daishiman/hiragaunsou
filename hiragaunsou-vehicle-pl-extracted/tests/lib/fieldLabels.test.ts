import { describe, expect, it } from "vitest";
import { FIELD_LABELS, formatCellValue, isNumericField } from "../../app/_lib/fieldLabels";
import type { VehiclePlField } from "../../src/domain/entities/VehiclePl";

describe("FIELD_LABELS", () => {
  it("全フィールドに日本語ラベルが定義されている", () => {
    const fields = Object.keys(FIELD_LABELS) as VehiclePlField[];
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(typeof FIELD_LABELS[f]).toBe("string");
      expect(FIELD_LABELS[f].length).toBeGreaterThan(0);
    }
  });

  it("代表的なフィールドのラベルが仕様どおり", () => {
    expect(FIELD_LABELS.no).toBe("車番");
    expect(FIELD_LABELS.profit).toBe("損益");
    expect(FIELD_LABELS.margin).toBe("利益率");
    expect(FIELD_LABELS.nempi).toBe("燃費");
  });
});

describe("isNumericField", () => {
  it("車番・車種名・所属・初年度登録・社員コード・運転者名はテキスト扱い(false)", () => {
    expect(isNumericField("no")).toBe(false);
    expect(isNumericField("type")).toBe(false);
    expect(isNumericField("depot")).toBe(false);
    expect(isNumericField("reg")).toBe(false);
    expect(isNumericField("code")).toBe(false);
    expect(isNumericField("driver")).toBe(false);
  });

  it("それ以外の項目は数値扱い(true)", () => {
    expect(isNumericField("trips")).toBe(true);
    expect(isNumericField("profit")).toBe(true);
    expect(isNumericField("margin")).toBe(true);
    expect(isNumericField("nempi")).toBe(true);
  });
});

describe("formatCellValue", () => {
  it("nullは—", () => {
    expect(formatCellValue("profit", null)).toBe("—");
  });

  it("テキストフィールドは値をそのまま文字列化する", () => {
    expect(formatCellValue("no", "12-34")).toBe("12-34");
    expect(formatCellValue("driver", "山田太郎")).toBe("山田太郎");
  });

  it("数値フィールドで数値に変換できない文字列は—", () => {
    expect(formatCellValue("profit", "abc")).toBe("—");
  });

  it("marginは百分率・小数第1位で表示する", () => {
    expect(formatCellValue("margin", 0.1523)).toBe("15.2%");
  });

  it("marginが0でも0.0%になる", () => {
    expect(formatCellValue("margin", 0)).toBe("0.0%");
  });

  it("nempiは小数第2位まで表示する", () => {
    expect(formatCellValue("nempi", 4.5)).toBe("4.50");
  });

  it("それ以外の数値フィールドは四捨五入した整数を3桁カンマ区切りにする", () => {
    expect(formatCellValue("profit", 1234.6)).toBe("1,235");
  });

  it("負の値は▲を付けずマイナス記号のまま表示する(グリッドセルはExcel互換表記)", () => {
    expect(formatCellValue("profit", -1234.6)).toBe("-1,235");
  });

  it("数値フィールドに数値文字列を渡しても変換して整形する", () => {
    expect(formatCellValue("sales", "1234.6")).toBe("1,235");
  });

  it("0は0のまま(—にならない)", () => {
    expect(formatCellValue("profit", 0)).toBe("0");
  });
});
