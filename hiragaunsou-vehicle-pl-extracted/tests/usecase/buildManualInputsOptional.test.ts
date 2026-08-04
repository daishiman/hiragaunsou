import { describe, expect, it } from "vitest";
import { buildManualInputs } from "../../src/usecase/steps/buildManualInputs";

/**
 * 実費入力(タイヤ・高速)は「未入力」を null のまま残さなければならない。
 * 0 に潰すと、請求書が届いていない車両まで 0 円で確定してしまい、
 * 標準原価・組合割引率へのフォールバックが二度と効かなくなる。
 */
describe("buildManualInputs の実費項目", () => {
  it("未指定・null・空文字は null のまま残す", () => {
    const [a, b, c] = buildManualInputs([
      { vehicleNo: "1" },
      { vehicleNo: "2", tireActual: null, tollActual: null, tollDiscountActual: null },
      { vehicleNo: "3", tireActual: "", tollActual: "", tollDiscountActual: "" },
    ]);
    for (const r of [a, b, c]) {
      expect(r!.tireActual).toBeNull();
      expect(r!.tollActual).toBeNull();
      expect(r!.tollDiscountActual).toBeNull();
    }
  });

  it("0 は「0円で確定」として保持する(null に丸めない)", () => {
    const [r] = buildManualInputs([
      { vehicleNo: "1", tireActual: 0, tollActual: 0, tollDiscountActual: 0 },
    ]);
    expect(r!.tireActual).toBe(0);
    expect(r!.tollActual).toBe(0);
    expect(r!.tollDiscountActual).toBe(0);
  });

  it("文字列の数値を受け取る(フォームからの値)", () => {
    const [r] = buildManualInputs([{ vehicleNo: "1", tireActual: "88000" }]);
    expect(r!.tireActual).toBe(88000);
  });

  it("負の実費は0に丸める(請求書に負の金額は無い)", () => {
    const [r] = buildManualInputs([{ vehicleNo: "1", tireActual: -500 }]);
    expect(r!.tireActual).toBe(0);
  });

  it("数値として読めない値は未入力として扱う(誤った0で確定させない)", () => {
    const [r] = buildManualInputs([{ vehicleNo: "1", tireActual: "あとで" }]);
    expect(r!.tireActual).toBeNull();
  });
});
