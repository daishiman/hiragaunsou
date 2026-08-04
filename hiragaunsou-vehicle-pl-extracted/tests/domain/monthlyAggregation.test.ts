import { describe, expect, it } from "vitest";
import {
  costPerKm,
  kmPrice,
  marginOf,
  monthTotals,
  salesPerKm,
  sumMonthTotals,
} from "../../src/domain/rules/monthlyAggregation";
import { plRow } from "../fixtures/vehiclePlRow";

describe("monthTotals", () => {
  it("在籍台数・稼働台数・赤字台数を数え分ける", () => {
    const totals = monthTotals([
      plRow({ no: "1", sales: 1_000_000, profit: 200_000 }),
      plRow({ no: "2", sales: 800_000, profit: -100_000 }),
      plRow({ no: "3", sales: 0, profit: -50_000 }), // 遊休 (売上0)
    ]);
    expect(totals.cars).toBe(3);
    expect(totals.active).toBe(2);
    expect(totals.deficitCars).toBe(2);
  });

  it("黒字車の利益合計と赤字車の損失合計を分けて持つ (利益の構造)", () => {
    const totals = monthTotals([
      plRow({ profit: 300_000 }),
      plRow({ profit: 100_000 }),
      plRow({ profit: -250_000 }),
    ]);
    expect(totals.profitPos).toBe(400_000);
    expect(totals.profitNeg).toBe(-250_000);
    expect(totals.profit).toBe(150_000);
  });

  it("行が空でもゼロ埋めした集計を返す (画面側で分岐させない)", () => {
    const totals = monthTotals([]);
    expect(totals.cars).toBe(0);
    expect(totals.sales).toBe(0);
    expect(marginOf(totals)).toBeNull();
    expect(costPerKm(totals)).toBeNull();
  });
});

describe("kmPrice", () => {
  it("売上 / 稼働Km を返す", () => {
    expect(kmPrice({ km: 10_000, sales: 1_800_000 })).toBe(180);
  });

  it("稼働Kmが0の車両は Infinity ではなく null を返す", () => {
    expect(kmPrice({ km: 0, sales: 500_000 })).toBeNull();
  });
});

describe("marginOf / costPerKm / salesPerKm", () => {
  it("利益率・1km原価・1km売上を算出する", () => {
    const totals = monthTotals([plRow({ sales: 2_000_000, expense: 1_700_000, profit: 300_000, km: 10_000 })]);
    expect(marginOf(totals)).toBeCloseTo(0.15, 10);
    expect(costPerKm(totals)).toBe(170);
    expect(salesPerKm(totals)).toBe(200);
  });
});

describe("sumMonthTotals", () => {
  it("複数月を合算する (年間合計行)", () => {
    const a = monthTotals([plRow({ sales: 100, expense: 60, profit: 40, km: 10 })]);
    const b = monthTotals([plRow({ sales: 200, expense: 150, profit: 50, km: 20 })]);
    const sum = sumMonthTotals([a, b]);
    expect(sum.sales).toBe(300);
    expect(sum.profit).toBe(90);
    expect(sum.km).toBe(30);
    expect(sum.cars).toBe(2);
  });
});
