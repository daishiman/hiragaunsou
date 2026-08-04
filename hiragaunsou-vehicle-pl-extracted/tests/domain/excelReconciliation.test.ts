import { describe, expect, it } from "vitest";
import {
  EXCEL_RECONCILE_FIELDS,
  reconcileWithExcel,
} from "../../src/domain/rules/excelReconciliation";
import type { VehiclePlCalculated } from "../../src/domain/rules/vehiclePlCalculation";

function row(no: string, overrides: Partial<VehiclePlCalculated> = {}): VehiclePlCalculated {
  const base: Record<string, unknown> = {
    no,
    type: "大型",
    depot: "本社",
    reg: null,
    code: null,
    driver: null,
  };
  for (const field of EXCEL_RECONCILE_FIELDS) base[field.field] = 0;
  base.mainte = 0;
  return { ...base, ...overrides } as unknown as VehiclePlCalculated;
}

describe("reconcileWithExcel", () => {
  it("Excel未取込なら突合しない", () => {
    const result = reconcileWithExcel([], [row("1")]);
    expect(result.hasExcel).toBe(false);
    expect(result.vehicles).toEqual([]);
  });

  it("一致している車両は一覧に出さない", () => {
    const result = reconcileWithExcel([row("1", { sales: 100 })], [row("1", { sales: 100 })]);
    expect(result.hasExcel).toBe(true);
    expect(result.comparedCount).toBe(1);
    expect(result.vehicles).toEqual([]);
  });

  it("1円以下の丸め差は食い違いとして扱わない", () => {
    const result = reconcileWithExcel([row("1", { sales: 100 })], [row("1", { sales: 100.4 })]);
    expect(result.vehicles).toEqual([]);
  });

  it("差額の大きい車両・項目から順に並ぶ", () => {
    const excel = [row("1", { sales: 100, profit: 100 }), row("2", { sales: 900, profit: 900 })];
    const system = [row("1", { sales: 300, profit: 300 }), row("2", { sales: 1000, profit: 1000 })];
    const result = reconcileWithExcel(excel, system);

    expect(result.vehicles.map((v) => v.vehicleNo)).toEqual(["1", "2"]);
    expect(result.vehicles[0].items[0]).toMatchObject({
      label: "運送収入",
      excel: 100,
      system: 300,
      diff: 200,
    });
    expect(result.mismatchItemCount).toBe(4);
  });

  it("Excel側の修繕費計が空の行は、メンテ(委託)列に入った計を突合相手にする", () => {
    // ★収支表のAC列(※修繕費計)が空で、AB列(メンテ)に計が入っている行がある。
    // これを0として比べると全車両が不一致になり、一覧が使い物にならない。
    const excel = [row("1", { repairTotal: 0, mainte: 5000 })];
    const system = [row("1", { repairTotal: 5000, mainte: 0 })];
    expect(reconcileWithExcel(excel, system).vehicles).toEqual([]);
  });

  it("片側にしか無い車両は件数だけ数える", () => {
    const result = reconcileWithExcel([row("1"), row("9")], [row("1")]);
    expect(result.comparedCount).toBe(1);
    expect(result.excelOnlyCount).toBe(1);
    expect(result.systemOnlyCount).toBe(0);
  });
});
