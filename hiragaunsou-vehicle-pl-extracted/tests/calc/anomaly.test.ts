import { describe, expect, it } from "vitest";
import {
  detectMissingInput,
  detectRangeDeviation,
  detectYoyDeviation,
} from "../../src/server/calc/anomaly";

describe("detectMissingInput", () => {
  it("必須項目が0/nullの車両を未入力として検知する", () => {
    const flags = detectMissingInput(
      [
        { vehicleNo: "1", field: "fuelIn", value: 0 },
        { vehicleNo: "2", field: "fuelIn", value: 40000 },
        { vehicleNo: "3", field: "fuelIn", value: null },
      ],
      ["fuelIn"],
    );
    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f.vehicleNo).sort()).toEqual(["1", "3"]);
    expect(flags.every((f) => f.type === "missing_input")).toBe(true);
  });

  it("対象外フィールドは検知しない", () => {
    const flags = detectMissingInput(
      [{ vehicleNo: "1", field: "misc", value: 0 }],
      ["fuelIn"],
    );
    expect(flags).toHaveLength(0);
  });
});

describe("detectRangeDeviation", () => {
  it("中央値から大きく外れた値(桁ミス疑い)を検知する", () => {
    const values = [
      { vehicleNo: "1", field: "repair", value: 10000 },
      { vehicleNo: "2", field: "repair", value: 12000 },
      { vehicleNo: "3", field: "repair", value: 11000 },
      { vehicleNo: "4", field: "repair", value: 1350000 }, // 桁ミス疑い(中央値の約100倍)
    ];
    const flags = detectRangeDeviation(values, 3);
    expect(flags).toHaveLength(1);
    expect(flags[0].vehicleNo).toBe("4");
    expect(flags[0].type).toBe("digit_suspect");
  });

  it("中央値の1/3未満の極端に低い値も検知する", () => {
    const values = [
      { vehicleNo: "1", field: "km", value: 5000 },
      { vehicleNo: "2", field: "km", value: 5200 },
      { vehicleNo: "3", field: "km", value: 4800 },
      { vehicleNo: "4", field: "km", value: 100 },
    ];
    const flags = detectRangeDeviation(values, 3);
    expect(flags.some((f) => f.vehicleNo === "4")).toBe(true);
  });

  it("母数が3未満のフィールドは判定しない(誤検知防止)", () => {
    const values = [
      { vehicleNo: "1", field: "repair", value: 1000 },
      { vehicleNo: "2", field: "repair", value: 999999 },
    ];
    expect(detectRangeDeviation(values, 3)).toHaveLength(0);
  });

  it("正常範囲の値はフラグしない", () => {
    const values = [
      { vehicleNo: "1", field: "km", value: 5000 },
      { vehicleNo: "2", field: "km", value: 5200 },
      { vehicleNo: "3", field: "km", value: 4800 },
    ];
    expect(detectRangeDeviation(values, 3)).toHaveLength(0);
  });
});

describe("detectYoyDeviation", () => {
  it("前年同月比で閾値を超える変動をフラグする", () => {
    const current = [{ vehicleNo: "1", field: "sales", value: 500000 }];
    const previous = [{ vehicleNo: "1", field: "sales", value: 1000000 }];
    const flags = detectYoyDeviation(current, previous, 0.3);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe("yoy_deviation");
  });

  it("閾値以内の変動はフラグしない", () => {
    const current = [{ vehicleNo: "1", field: "sales", value: 950000 }];
    const previous = [{ vehicleNo: "1", field: "sales", value: 1000000 }];
    expect(detectYoyDeviation(current, previous, 0.3)).toHaveLength(0);
  });

  it("前年データが存在しない車両は判定しない", () => {
    const current = [{ vehicleNo: "9", field: "sales", value: 100 }];
    expect(detectYoyDeviation(current, [], 0.3)).toHaveLength(0);
  });
});
