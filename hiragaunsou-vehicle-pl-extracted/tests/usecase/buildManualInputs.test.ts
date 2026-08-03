import { describe, expect, it } from "vitest";
import { buildManualInputs } from "../../src/usecase/steps/buildManualInputs";

describe("buildManualInputs", () => {
  it("文字列の数値を数値に変換する", () => {
    const res = buildManualInputs([{ vehicleNo: "1", repairActual: "12000" }]);
    expect(res[0]!.repairActual).toBe(12000);
  });

  it("未入力フィールドは0にする", () => {
    const res = buildManualInputs([{ vehicleNo: "1" }]);
    expect(res[0]).toEqual({
      vehicleNo: "1",
      fuelInQty: 0,
      fuelOut: 0,
      fuelOutQty: 0,
      adblue: 0,
      repairActual: 0,
      equip: 0,
      mainte: 0,
      miscOther: 0,
    });
  });

  it("NaN・負値は0にクランプする(ゼロ除算等の異常入力を通さない)", () => {
    const res = buildManualInputs([{ vehicleNo: "1", repairActual: "abc", equip: -500 }]);
    expect(res[0]!.repairActual).toBe(0);
    expect(res[0]!.equip).toBe(0);
  });

  it("vehicleNoが空文字のレコードは除外する", () => {
    const res = buildManualInputs([{ vehicleNo: "" }, { vehicleNo: "  " }, { vehicleNo: "5" }]);
    expect(res).toHaveLength(1);
    expect(res[0]!.vehicleNo).toBe("5");
  });
});
