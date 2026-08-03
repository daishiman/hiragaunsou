import { describe, expect, it } from "vitest";
import { calculateVehiclePl, type VehiclePlInput } from "../../src/domain/rules/vehiclePlCalculation";
import { isCharteredVehicle } from "../../src/domain/rules/charteredVehicle";

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
    km: 5429.58,
    fare: 1000000,
    fee: 20000,
    toll: 100000,
    fuelInQty: 1000,
    fuelOutQty: 0,
    fuelOut: 0,
    adblue: 0,
    repairActual: 0,
    equip: 1350,
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

describe("calculateVehiclePl", () => {
  it("運送収入 = 運賃 + 附帯料金", () => {
    const r = calculateVehiclePl(baseInput({ fare: 1000000, fee: 20000 }));
    expect(r.sales).toBe(1020000);
  });

  it("高速割引料 = 道路使用料 × 0.356、運行費計 = 道路使用料 - 高速割引料", () => {
    const r = calculateVehiclePl(baseInput({ toll: 100000 }));
    expect(r.tollDisc).toBeCloseTo(35600, 2);
    expect(r.tollNet).toBeCloseTo(64400, 2);
  });

  it("割引率はレート設定から変更可能 (ハードコード禁止)", () => {
    const r = calculateVehiclePl(baseInput({ toll: 100000 }), {
      tollDiscountRate: 0.5,
      adminFeeRate: 0.169,
      bonusAnnual: 400000,
      tankPricePerLiter: 0,
    });
    expect(r.tollDisc).toBe(50000);
    expect(r.tollNet).toBe(50000);
  });

  it("給油量合計と燃費 = 稼働Km / 給油量合計", () => {
    const r = calculateVehiclePl(
      baseInput({ km: 1000, fuelInQty: 100, fuelOutQty: 50 }),
    );
    expect(r.fuelQty).toBe(150);
    expect(r.nempi).toBeCloseTo(6.6667, 2);
  });

  it("給油量合計が0の場合、燃費は0(0除算回避)", () => {
    const r = calculateVehiclePl(
      baseInput({ km: 1000, fuelInQty: 0, fuelOutQty: 0 }),
    );
    expect(r.nempi).toBe(0);
  });

  it("燃料費計 = インタンク軽油代 + 外部軽油代 + 外部アドブルー、インタンク単価は月次設定値", () => {
    const r = calculateVehiclePl(
      baseInput({ fuelInQty: 100, fuelOut: 5000, adblue: 300 }),
      { ...DEFAULT_RATES(), tankPricePerLiter: 120.21 },
    );
    expect(r.fuelIn).toBeCloseTo(12021, 2);
    expect(r.fuelTotal).toBeCloseTo(12021 + 5000 + 300, 2);
  });

  it("修繕費計 = 修理費実費 + タイヤ標準原価 + 備品費 + メンテ委託、修理費実費と標準原価は別フィールド保持", () => {
    const r = calculateVehiclePl(
      baseInput({
        km: 1000,
        repairActual: 50000,
        equip: 1350,
        mainte: 2000,
        standardCostRate: { repairPerKm: 10.7, tirePerKm: 2.1 },
      }),
    );
    expect(r.repair).toBe(50000); // 実費は別保持、標準原価と混同しない
    expect(r.repairStandard).toBeCloseTo(10700, 2); // km(1000) × 10.7
    expect(r.tire).toBeCloseTo(2100, 2); // km(1000) × 2.1
    expect(r.repairTotal).toBeCloseTo(50000 + 2100 + 1350 + 2000, 2);
  });

  it("人件費計 = 給与 + 賞与(年40万/12固定) + 福利厚生費", () => {
    const r = calculateVehiclePl(baseInput({ salary: 250000, welfare: 40000 }));
    expect(r.bonus).toBeCloseTo(400000 / 12, 2);
    expect(r.laborTotal).toBeCloseTo(250000 + 400000 / 12 + 40000, 2);
  });

  it("賞与年額はレート設定で変更可能", () => {
    const r = calculateVehiclePl(baseInput(), {
      ...DEFAULT_RATES(),
      bonusAnnual: 480000,
    });
    expect(r.bonus).toBeCloseTo(40000, 2);
  });

  it("保険料計/賦課税計/諸経費計/運送費計", () => {
    const r = calculateVehiclePl(
      baseInput({
        insCompulsory: 2008,
        insVoluntary: 12580,
        taxAuto: 5675,
        taxWeight: 5417,
        miscOther: 999,
        lease: 10000,
        installment: 20000,
      }),
    );
    expect(r.insTotal).toBeCloseTo(14588, 2);
    expect(r.taxTotal).toBeCloseTo(11092, 2);
    expect(r.miscTotal).toBe(999);
    expect(r.transportTotal).toBe(30000);
  });

  it("一般管理費 = 運送収入 × 設定レート(デフォルト16.9%)、ハードコードせずレートを変更できる", () => {
    const r1 = calculateVehiclePl(baseInput({ fare: 1000000, fee: 0 }));
    expect(r1.adminFee).toBeCloseTo(1000000 * 0.169, 2);

    const r2 = calculateVehiclePl(baseInput({ fare: 1000000, fee: 0 }), {
      ...DEFAULT_RATES(),
      adminFeeRate: 0.2,
    });
    expect(r2.adminFee).toBeCloseTo(200000, 2);
  });

  it("固定費 = 保険料計+賦課税計+運送費計 / 変動費 = 燃料+修繕+運行費+人件費+諸経費+管理費 / 経費計 = 固定費+変動費", () => {
    const r = calculateVehiclePl(baseInput());
    expect(r.fixed).toBeCloseTo(r.insTotal + r.taxTotal + r.transportTotal, 2);
    expect(r.variable).toBeCloseTo(
      r.fuelTotal + r.repairTotal + r.tollNet + r.laborTotal + r.miscTotal + r.adminTotal,
      2,
    );
    expect(r.expense).toBeCloseTo(r.fixed + r.variable, 2);
  });

  it("損益 = 運送収入 - 経費計 / 利益率 = 損益 ÷ 運送収入", () => {
    const r = calculateVehiclePl(baseInput());
    expect(r.profit).toBeCloseTo(r.sales - r.expense, 2);
    expect(r.margin).toBeCloseTo(r.profit / r.sales, 2);
  });

  it("運送収入が0のとき利益率は0除算せず0を返す", () => {
    const r = calculateVehiclePl(baseInput({ fare: 0, fee: 0 }));
    expect(r.margin).toBe(0);
  });
});

describe("isCharteredVehicle", () => {
  it("車番88888は傭車として機械的に判定できる", () => {
    expect(isCharteredVehicle("88888")).toBe(true);
    expect(isCharteredVehicle(" 88888 ")).toBe(true);
  });

  it("それ以外の車番は傭車ではない", () => {
    expect(isCharteredVehicle("1")).toBe(false);
    expect(isCharteredVehicle("888880")).toBe(false);
  });
});

function DEFAULT_RATES() {
  return {
    tollDiscountRate: 0.356,
    adminFeeRate: 0.169,
    bonusAnnual: 400000,
    tankPricePerLiter: 0,
  };
}
