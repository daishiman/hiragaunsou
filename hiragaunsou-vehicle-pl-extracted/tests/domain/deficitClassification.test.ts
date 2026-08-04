import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEFICIT_THRESHOLDS,
  classifyDeficit,
  kmPriceBuckets,
} from "../../src/domain/rules/deficitClassification";
import { plRow } from "../fixtures/vehiclePlRow";

describe("classifyDeficit", () => {
  it("黒字車は3分類のどこにも入らない", () => {
    const groups = classifyDeficit([plRow({ no: "1", sales: 1_000_000, profit: 50_000 })]);
    expect(groups.idle).toHaveLength(0);
    expect(groups.repair).toHaveLength(0);
    expect(groups.price).toHaveLength(0);
  });

  it("売上が閾値未満の赤字車は遊休・低稼働型に入る", () => {
    const groups = classifyDeficit([
      plRow({ no: "1", sales: 100_000, repair: 500_000, profit: -400_000 }),
    ]);
    // 修繕が突出していても、まず売上の低さ (遊休) を理由として提示する
    expect(groups.idle.map((r) => r.no)).toEqual(["1"]);
    expect(groups.repair).toHaveLength(0);
  });

  it("売上が足りていて修繕費が閾値以上の赤字車は突発修繕型に入る", () => {
    const groups = classifyDeficit([
      plRow({ no: "2", sales: 1_500_000, repair: 400_000, profit: -200_000 }),
    ]);
    expect(groups.repair.map((r) => r.no)).toEqual(["2"]);
  });

  it("遊休でも突発修繕でもない赤字車は単価・効率型に落ちる", () => {
    const groups = classifyDeficit([
      plRow({ no: "3", sales: 1_500_000, repair: 10_000, profit: -100_000 }),
    ]);
    expect(groups.price.map((r) => r.no)).toEqual(["3"]);
  });

  it("閾値は差し替えできる (率マスタから読む前提)", () => {
    const rows = [plRow({ no: "4", sales: 400_000, repair: 0, profit: -50_000 })];
    expect(classifyDeficit(rows).price).toHaveLength(1);
    expect(classifyDeficit(rows, { ...DEFAULT_DEFICIT_THRESHOLDS, idleSales: 500_000 }).idle).toHaveLength(1);
  });
});

describe("kmPriceBuckets", () => {
  it("6区分に振り分け、損益分岐(170円)未満の区分に印を付ける", () => {
    const buckets = kmPriceBuckets(
      [
        plRow({ no: "1", km: 10_000, sales: 1_200_000, profit: -50_000 }), // 120円/km
        plRow({ no: "2", km: 10_000, sales: 1_800_000, profit: 100_000 }), // 180円/km
        plRow({ no: "3", km: 10_000, sales: 2_200_000, profit: 300_000 }), // 220円/km
      ],
      170,
    );
    expect(buckets).toHaveLength(6);
    const counts = Object.fromEntries(buckets.map((b) => [b.label, b.count]));
    expect(counts["130円未満"]).toBe(1);
    expect(counts["170〜190円"]).toBe(1);
    expect(counts["210円以上"]).toBe(1);

    const below = buckets.filter((b) => b.belowBreakEven).map((b) => b.label);
    expect(below).toEqual(["130円未満", "130〜150円", "150〜170円"]);
  });

  it("稼働Kmが0の車両は単価を算出できないので集計から外す", () => {
    const buckets = kmPriceBuckets([plRow({ no: "1", km: 0, sales: 500_000 })], 170);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(0);
  });

  it("区分ごとの赤字台数を数える", () => {
    const buckets = kmPriceBuckets(
      [
        plRow({ no: "1", km: 10_000, sales: 1_200_000, profit: -50_000 }),
        plRow({ no: "2", km: 10_000, sales: 1_250_000, profit: 10_000 }),
      ],
      170,
    );
    const first = buckets.find((b) => b.label === "130円未満");
    expect(first?.count).toBe(2);
    expect(first?.deficit).toBe(1);
  });
});
