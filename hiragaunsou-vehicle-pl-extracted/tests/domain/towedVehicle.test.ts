import { describe, expect, it } from "vitest";
import { formatVehicleNoLabel, mergeTowedVehicles } from "../../src/domain/rules/towedVehicle";
import {
  calculateVehiclePl,
  DEFAULT_RATE_SETTINGS,
  type VehiclePlInput,
} from "../../src/domain/rules/vehiclePlCalculation";

function input(overrides: Partial<VehiclePlInput> = {}): VehiclePlInput {
  return {
    no: "2",
    type: "セミトレ",
    depot: "本社",
    reg: null,
    code: "714",
    driver: "水口晶尋",
    trips: 0,
    slips: 0,
    hours: 0,
    km: 0,
    fare: 0,
    fee: 0,
    toll: 0,
    fuelInQty: 0,
    fuelOutQty: 0,
    fuelOut: 0,
    adblue: 0,
    repairActual: 0,
    equip: 0,
    mainte: 0,
    salary: 0,
    welfare: 0,
    insCompulsory: 0,
    insVoluntary: 0,
    taxAuto: 0,
    taxWeight: 0,
    miscOther: 0,
    lease: 0,
    installment: 0,
    standardCostRate: { repairPerKm: 7.6, tirePerKm: 3.3 },
    driverCount: 1,
    ...overrides,
  };
}

describe("mergeTowedVehicles", () => {
  it("けん引するトレーラが無ければ入力をそのまま返す", () => {
    const tractor = input();
    expect(mergeTowedVehicles(tractor, [])).toBe(tractor);
  });

  /**
   * トレーラは車検証上は別車両なので保険・税・リース料が単独で付く。
   * これを合算しないと、トレーラ側が「売上ゼロ・費用だけの赤字行」として収支表に残る。
   */
  it("トレーラの固定費をトラクタに足し込む", () => {
    const merged = mergeTowedVehicles(input({ insCompulsory: 2452, taxAuto: 8216, lease: 30000 }), [
      input({ no: "1100", type: "被けん引車", insCompulsory: 900, taxAuto: 5000, lease: 12000 }),
    ]);

    expect(merged.insCompulsory).toBe(2452 + 900);
    expect(merged.taxAuto).toBe(8216 + 5000);
    expect(merged.lease).toBe(30000 + 12000);
  });

  it("車番・車種・運転者・標準原価単価はトラクタのものを残す", () => {
    const merged = mergeTowedVehicles(input(), [
      input({
        no: "1100",
        type: "被けん引車",
        driver: null,
        code: null,
        standardCostRate: { repairPerKm: 0, tirePerKm: 0 },
      }),
    ]);

    expect(merged.no).toBe("2");
    expect(merged.type).toBe("セミトレ");
    expect(merged.driver).toBe("水口晶尋");
    // トレーラは自走しないので、走行距離に応じた単価表はトラクタ側の一つだけが正しい
    expect(merged.standardCostRate).toEqual({ repairPerKm: 7.6, tirePerKm: 3.3 });
  });

  it("吸収したトレーラの車番を残す(収支表の車番ラベルを組み立てるため)", () => {
    const merged = mergeTowedVehicles(input({ no: "129" }), [input({ no: "1113" })]);
    expect(merged.towedVehicleNos).toEqual(["1113"]);
  });

  /**
   * tireActual などの null は「未入力だから標準原価にフォールバックする」という意味を持つ。
   * 0 に潰すと、実費未入力の車両のタイヤ費が静かに 0 円になる。
   */
  it("実費の未入力(null)は、両方未入力なら null のまま残す", () => {
    const merged = mergeTowedVehicles(input({ tireActual: null, tollActual: 5000 }), [
      input({ no: "1100", tireActual: null, tollActual: null }),
    ]);

    expect(merged.tireActual).toBeNull();
    expect(merged.tollActual).toBe(5000);
  });

  it("片方だけ実費が入っていればその額になる", () => {
    const merged = mergeTowedVehicles(input({ tireActual: null }), [
      input({ no: "1100", tireActual: 30000 }),
    ]);
    expect(merged.tireActual).toBe(30000);
  });

  /**
   * 実データ(2026年5月・車番2 + トレーラ1100)。
   * 合算「してから」計算しないと、一般管理費が合算前の運送収入に対する額の和になり、
   * 「一般管理費 = 運送収入 × 率」が成り立たない行が生まれる。
   * 現行Excelの最終成果物との差 12,868.776 円 = 73,620 × 0.1748 がこの再計算分。
   */
  it("合算してから計算するので、一般管理費が合算後の運送収入に対して掛かる", () => {
    const rates = { ...DEFAULT_RATE_SETTINGS, adminFeeRate: 0.1748 };
    const tractor = input({ fare: 1_513_645, fee: 13_580 });
    const trailer = input({ no: "1100", type: "被けん引車", fare: 73_620, slips: 1 });

    const beforeMerge = calculateVehiclePl(tractor, rates);
    const afterMerge = calculateVehiclePl(mergeTowedVehicles(tractor, [trailer]), rates);

    expect(beforeMerge.adminFee).toBeCloseTo(266_958.93, 2);
    expect(afterMerge.sales).toBe(1_513_645 + 13_580 + 73_620);
    // 合算後の運送収入に率が掛かっていること自体が要件。トレーラを足しただけの
    // 「率が掛かっていない加算」になっていれば、この関係が崩れる。
    expect(afterMerge.adminFee).toBeCloseTo(afterMerge.sales * 0.1748, 2);
    // 現行Excelとの差 12,868.776 円 (= 73,620 × 0.1748)。銭単位の丸めの分だけずれる。
    expect(afterMerge.adminFee - beforeMerge.adminFee).toBeCloseTo(12_868.776, 1);
    // 下流の関係は合算後も成立する
    expect(afterMerge.profit).toBeCloseTo(afterMerge.sales - afterMerge.expense, 6);
  });
});

describe("formatVehicleNoLabel", () => {
  it("トレーラが無ければ車番をそのまま返す", () => {
    expect(formatVehicleNoLabel("101", [])).toBe("101");
  });

  /** 現行Excelは「129　　1113」「385/100」と区切りが揃っていないので "/" に統一する。 */
  it("吸収したトレーラを / でつないだラベルにする", () => {
    expect(formatVehicleNoLabel("129", ["1113"])).toBe("129/1113");
    expect(formatVehicleNoLabel("385", ["100", "113"])).toBe("385/100/113");
  });

  it("DBに入っているカンマ区切り文字列からも組み立てられる", () => {
    expect(formatVehicleNoLabel("2", "1100")).toBe("2/1100");
    expect(formatVehicleNoLabel("2", "")).toBe("2");
    expect(formatVehicleNoLabel("2", " 1100 , 1000 ")).toBe("2/1100/1000");
  });
});
