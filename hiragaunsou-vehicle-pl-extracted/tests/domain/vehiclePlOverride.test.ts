import { describe, expect, it } from "vitest";
import {
  applyVehiclePlOverride,
  isOverridableField,
  OVERRIDABLE_FIELDS,
  parseOverrideValues,
} from "../../src/domain/rules/vehiclePlOverride";
import {
  calculateVehiclePl,
  DEFAULT_RATE_SETTINGS,
  type VehiclePlInput,
} from "../../src/domain/rules/vehiclePlCalculation";

function baseInput(overrides: Partial<VehiclePlInput> = {}): VehiclePlInput {
  return {
    no: "10",
    type: "大型",
    depot: "本社",
    reg: null,
    code: "1001",
    driver: "山田太郎",
    trips: 20,
    slips: 30,
    hours: 180,
    km: 8000,
    fare: 1_050_000,
    fee: 50_000,
    toll: 0,
    fuelInQty: 0,
    fuelOutQty: 0,
    fuelOut: 0,
    adblue: 0,
    repairActual: 0,
    equip: 0,
    mainte: 0,
    salary: 400_000,
    welfare: 60_000,
    insCompulsory: 0,
    insVoluntary: 0,
    taxAuto: 0,
    taxWeight: 0,
    miscOther: 0,
    lease: 0,
    installment: 0,
    standardCostRate: { repairPerKm: 0, tirePerKm: 0 },
    driverCount: 1,
    ...overrides,
  };
}

describe("OVERRIDABLE_FIELDS", () => {
  /**
   * この一覧が「何を人が直せるか」の定義そのもの。計算結果(profit/expense/sales や各小計)が
   * 紛れ込むと、内訳と小計の関係で値の破損を検出する仕掛けが効かなくなる。
   * VehiclePlInput のキーであることは型が保証するので、ここでは意図しない項目が
   * 増えていないかを人の目で追える形に固定する。
   */
  it("上書きできるのは計算の入口の値だけ", () => {
    expect([...OVERRIDABLE_FIELDS]).toEqual([
      "trips",
      "slips",
      "hours",
      "km",
      "fare",
      "fee",
      "salary",
      "welfare",
      "driverCount",
      "bonusMonthly",
    ]);
  });

  it("専用の入力経路がある項目は上書き対象にしない", () => {
    // 燃料・修理・タイヤ・高速は手入力画面、保険・税・リースは車両マスタが正規経路
    for (const field of ["fuelOut", "repairActual", "tireActual", "tollActual", "lease", "taxAuto"]) {
      expect(isOverridableField(field)).toBe(false);
    }
  });

  it("計算結果は上書きできない", () => {
    for (const field of ["profit", "expense", "sales", "laborTotal", "margin"]) {
      expect(isOverridableField(field)).toBe(false);
    }
  });
});

describe("applyVehiclePlOverride", () => {
  it("上書きが無ければ入力をそのまま返す", () => {
    const input = baseInput();
    expect(applyVehiclePlOverride(input, undefined)).toEqual(input);
  });

  it("指定した項目だけを差し替え、他は触らない", () => {
    const applied = applyVehiclePlOverride(baseInput(), {
      vehicleNo: "10",
      excluded: false,
      values: { fare: 900_000 },
      reason: "請求側の減額",
    });

    expect(applied.fare).toBe(900_000);
    expect(applied.fee).toBe(50_000);
    expect(applied.salary).toBe(400_000);
  });

  /**
   * 上書きは計算の入口にしか効かない。ここが崩れると
   * 「損益 = 運送収入 - 経費計」が成り立たない行が収支表に生まれる。
   */
  it("上書き後も 損益 = 運送収入 - 経費計 が成立する", () => {
    const result = calculateVehiclePl(
      applyVehiclePlOverride(baseInput(), {
        vehicleNo: "10",
        excluded: false,
        values: { fare: 900_000, salary: 500_000 },
        reason: "請求側の減額と給与按分",
      }),
      DEFAULT_RATE_SETTINGS,
    );

    expect(result.sales).toBe(950_000);
    expect(result.profit).toBe(Math.round((result.sales - result.expense) * 100) / 100);
    expect(result.laborTotal).toBe(
      Math.round((result.salary + result.bonus + result.welfare) * 100) / 100,
    );
  });

  /**
   * 車番7219の 25,001 → 25,000。賞与は年額÷12×人数で決まるため、
   * 人数の上書きでは1円の丸めを表現できない。月額そのものを入口として持つ。
   */
  it("賞与の月額を直接指定すると、年額÷12の計算より優先される", () => {
    const applied = applyVehiclePlOverride(baseInput({ driverCount: 1 }), {
      vehicleNo: "7219",
      excluded: false,
      values: { bonusMonthly: 25_000 },
      reason: "Excelの丸めに合わせる",
    });

    const result = calculateVehiclePl(applied, { ...DEFAULT_RATE_SETTINGS, bonusAnnual: 300_012 });

    expect(result.bonus).toBe(25_000);
    expect(result.laborTotal).toBe(400_000 + 25_000 + 60_000);
  });

  it("上書きできない項目・数値でない値はAPI経由で紛れ込んでも無視する", () => {
    const applied = applyVehiclePlOverride(baseInput(), {
      vehicleNo: "10",
      excluded: false,
      values: {
        fare: Number.NaN,
        profit: 999,
        km: "8000",
      } as never,
      reason: "壊れた入力",
    });

    expect(applied.fare).toBe(1_050_000);
    expect(applied.km).toBe(8000);
    expect((applied as Record<string, unknown>).profit).toBeUndefined();
  });
});

describe("parseOverrideValues", () => {
  it("保存済みJSONから上書き可能な数値だけを取り出す", () => {
    expect(parseOverrideValues('{"fare":900000,"profit":1,"km":"8000"}')).toEqual({
      fare: 900000,
    });
  });

  it("壊れたJSON・配列・nullは空として扱う(収支表を落とさない)", () => {
    expect(parseOverrideValues("{壊れ")).toEqual({});
    expect(parseOverrideValues("[1,2]")).toEqual({});
    expect(parseOverrideValues("null")).toEqual({});
  });
});
