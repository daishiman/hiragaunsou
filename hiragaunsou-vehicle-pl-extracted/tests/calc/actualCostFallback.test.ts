import { describe, expect, it } from "vitest";
import { calculateVehiclePl, type VehiclePlInput } from "../../src/domain/rules/vehiclePlCalculation";

/**
 * 業務フロー STEP5(タイヤ)・STEP6(高速料金)の実費入力。
 *
 * 請求書が届いた車両は実費、届いていない車両は従来どおりの推計。
 * ここで「未入力(null)」と「0円」を取り違えると、請求書に載っていない車両を
 * 0円で確定してしまうため、両方をテストで固定する。
 */
function baseInput(overrides: Partial<VehiclePlInput> = {}): VehiclePlInput {
  return {
    no: "1",
    type: "10ｔW",
    depot: "本社",
    reg: "2013-03",
    code: "95",
    driver: "原田茂美",
    trips: 23,
    slips: 28,
    hours: 177.8,
    km: 10000,
    fare: 1000000,
    fee: 20000,
    toll: 100000,
    fuelInQty: 1000,
    fuelOutQty: 0,
    fuelOut: 0,
    adblue: 0,
    repairActual: 0,
    equip: 0,
    mainte: 0,
    salary: 250000,
    welfare: 40000,
    insCompulsory: 2008,
    insVoluntary: 12580,
    taxAuto: 5675,
    taxWeight: 5417,
    miscOther: 0,
    lease: 0,
    installment: 0,
    standardCostRate: { repairPerKm: 10.7, tirePerKm: 2.1 },
    ...overrides,
  };
}

describe("タイヤ費 (STEP5)", () => {
  it("実費が未入力なら 稼働Km × タイヤ単価 の標準原価を使う", () => {
    const r = calculateVehiclePl(baseInput({ km: 10000, tireActual: null }));
    expect(r.tire).toBe(21000);
  });

  it("tireActual を省略した場合も標準原価にフォールバックする(既存呼び出しを壊さない)", () => {
    const r = calculateVehiclePl(baseInput({ km: 10000 }));
    expect(r.tire).toBe(21000);
  });

  it("実費が入力されていれば実費を使う(標準原価は使わない)", () => {
    const r = calculateVehiclePl(baseInput({ km: 10000, tireActual: 88000 }));
    expect(r.tire).toBe(88000);
  });

  it("0円と入力されたら0円で確定する(未入力とは区別する)", () => {
    const r = calculateVehiclePl(baseInput({ km: 10000, tireActual: 0 }));
    expect(r.tire).toBe(0);
  });
});

describe("高速料金 (STEP6)", () => {
  it("実費が未入力なら 通行料 × 組合割引率 で割引額を推計する", () => {
    const r = calculateVehiclePl(baseInput({ toll: 100000 }));
    expect(r.toll).toBe(100000);
    expect(r.tollDisc).toBeCloseTo(35600, 2);
    expect(r.tollNet).toBeCloseTo(64400, 2);
  });

  it("請求書の通行料金の実費が入力されていれば、売上モニタリスト由来の値より優先する", () => {
    const r = calculateVehiclePl(baseInput({ toll: 100000, tollActual: 120000 }));
    expect(r.toll).toBe(120000);
    expect(r.tollDisc).toBeCloseTo(42720, 2);
    expect(r.tollNet).toBeCloseTo(77280, 2);
  });

  it("個別割引額を合算した実費が入力されていれば、割引率での推計を使わない", () => {
    const r = calculateVehiclePl(
      baseInput({ toll: 100000, tollActual: 120000, tollDiscountActual: 41234 }),
    );
    expect(r.tollDisc).toBe(41234);
    expect(r.tollNet).toBe(120000 - 41234);
  });

  it("割引額0円(割引が付かなかった月)も入力どおり0円で確定する", () => {
    const r = calculateVehiclePl(baseInput({ toll: 100000, tollDiscountActual: 0 }));
    expect(r.tollDisc).toBe(0);
    expect(r.tollNet).toBe(100000);
  });
});
