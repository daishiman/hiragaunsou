import { describe, expect, it } from "vitest";
import {
  aggregateByDepot,
  aggregateByVehicle,
  costBreakdown,
  deficitRanking,
  diffRatio,
  monthBefore,
  periodYearMonths,
  periodLabel,
} from "../../src/domain/rules/periodAggregation";
import { monthTotals } from "../../src/domain/rules/monthlyAggregation";
import { plRow } from "../fixtures/vehiclePlRow";

describe("periodYearMonths", () => {
  it("開始月から終了月までを昇順で列挙する", () => {
    expect(periodYearMonths("2026-03", "2026-06")).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });

  it("年をまたぐ期間も連続して列挙する", () => {
    expect(periodYearMonths("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("開始と終了が同じなら1ヶ月だけ返す", () => {
    expect(periodYearMonths("2026-05", "2026-05")).toEqual(["2026-05"]);
  });

  it("開始が終了より後なら空を返す (画面から逆順で渡っても壊れない)", () => {
    expect(periodYearMonths("2026-06", "2026-03")).toEqual([]);
  });
});

describe("periodLabel", () => {
  it("単月なら1つの年月として表示する", () => {
    expect(periodLabel(["2026-05"])).toBe("2026年5月");
  });

  it("複数月なら開始〜終了と月数を表示する", () => {
    expect(periodLabel(["2026-03", "2026-04", "2026-05"])).toBe("2026年3月〜2026年5月 (3ヶ月)");
  });

  it("空の期間は — を返す", () => {
    expect(periodLabel([])).toBe("—");
  });
});

describe("costBreakdown", () => {
  it("経費を科目別に分解し、金額の大きい順に並べる", () => {
    const totals = monthTotals([
      plRow({
        no: "1",
        expense: 1_000_000,
        laborTotal: 500_000,
        fuelTotal: 200_000,
        repairTotal: 100_000,
        tollNet: 150_000,
        transportTotal: 30_000,
        adminTotal: 10_000,
        insTotal: 6_000,
        taxTotal: 4_000,
      }),
    ]);
    const slices = costBreakdown(totals);

    expect(slices.map((s) => s.label)).toEqual([
      "人件費",
      "燃料費",
      "運行費",
      "修繕費",
      "リース・割賦",
      "一般管理費",
      "保険料",
      "賦課税",
    ]);
    expect(slices[0]?.amount).toBe(500_000);
  });

  it("構成比は経費計に対する比率になる", () => {
    const totals = monthTotals([
      plRow({ no: "1", expense: 1_000_000, laborTotal: 250_000 }),
    ]);
    const labor = costBreakdown(totals).find((s) => s.label === "人件費");

    expect(labor?.share).toBeCloseTo(0.25, 10);
  });

  it("経費0のときは構成比をnullにする (0除算をそのまま画面に出さない)", () => {
    const slices = costBreakdown(monthTotals([]));

    expect(slices.every((s) => s.share === null)).toBe(true);
    expect(slices.every((s) => s.amount === 0)).toBe(true);
  });
});

describe("aggregateByVehicle", () => {
  it("複数月にまたがる同一車番を1件に合算する", () => {
    const list = aggregateByVehicle(
      new Map([
        ["2026-04", [plRow({ no: "101", sales: 1_000_000, expense: 900_000, profit: 100_000, km: 5_000 })]],
        ["2026-05", [plRow({ no: "101", sales: 1_200_000, expense: 1_000_000, profit: 200_000, km: 6_000 })]],
      ]),
    );

    expect(list).toHaveLength(1);
    expect(list[0]?.vehicleNo).toBe("101");
    expect(list[0]?.sales).toBe(2_200_000);
    expect(list[0]?.profit).toBe(300_000);
    expect(list[0]?.km).toBe(11_000);
    expect(list[0]?.monthCount).toBe(2);
  });

  it("車種・所属・運転者は最新月の値を採用する (途中で乗務員が変わっても最新を出す)", () => {
    const list = aggregateByVehicle(
      new Map([
        ["2026-04", [plRow({ no: "101", depot: "本社", driver: "旧担当" })]],
        ["2026-05", [plRow({ no: "101", depot: "北営業所", driver: "新担当" })]],
      ]),
    );

    expect(list[0]?.depot).toBe("北営業所");
    expect(list[0]?.driver).toBe("新担当");
  });

  it("データが1件も無ければ空配列を返す", () => {
    expect(aggregateByVehicle(new Map())).toEqual([]);
  });
});

describe("deficitRanking", () => {
  it("損失の大きい順 (損益の小さい順) に並べ、黒字車は除外する", () => {
    const list = aggregateByVehicle(
      new Map([
        [
          "2026-05",
          [
            plRow({ no: "1", profit: 50_000 }),
            plRow({ no: "2", profit: -300_000 }),
            plRow({ no: "3", profit: -80_000 }),
          ],
        ],
      ]),
    );
    const ranking = deficitRanking(list, 10);

    expect(ranking.map((v) => v.vehicleNo)).toEqual(["2", "3"]);
  });

  it("limitで件数を切る", () => {
    const list = aggregateByVehicle(
      new Map([
        [
          "2026-05",
          [plRow({ no: "1", profit: -10 }), plRow({ no: "2", profit: -20 }), plRow({ no: "3", profit: -30 })],
        ],
      ]),
    );

    expect(deficitRanking(list, 2).map((v) => v.vehicleNo)).toEqual(["3", "2"]);
  });
});

describe("aggregateByDepot", () => {
  it("営業所ごとに台数・赤字台数・損益を集計する", () => {
    const vehicles = aggregateByVehicle(
      new Map([
        [
          "2026-05",
          [
            plRow({ no: "1", depot: "本社", sales: 1_000_000, expense: 800_000, profit: 200_000 }),
            plRow({ no: "2", depot: "本社", sales: 500_000, expense: 700_000, profit: -200_000 }),
            plRow({ no: "3", depot: "北営業所", sales: 900_000, expense: 600_000, profit: 300_000 }),
          ],
        ],
      ]),
    );
    const depots = aggregateByDepot(vehicles);

    const honsha = depots.find((d) => d.depot === "本社");
    expect(honsha?.cars).toBe(2);
    expect(honsha?.deficitCars).toBe(1);
    expect(honsha?.profit).toBe(0);
    expect(honsha?.margin).toBe(0);

    const kita = depots.find((d) => d.depot === "北営業所");
    expect(kita?.cars).toBe(1);
    expect(kita?.deficitCars).toBe(0);
  });

  it("売上順に並べる (規模の大きい営業所を先に見せる)", () => {
    const vehicles = aggregateByVehicle(
      new Map([
        [
          "2026-05",
          [
            plRow({ no: "1", depot: "小規模", sales: 100_000 }),
            plRow({ no: "2", depot: "大規模", sales: 900_000 }),
          ],
        ],
      ]),
    );

    expect(aggregateByDepot(vehicles).map((d) => d.depot)).toEqual(["大規模", "小規模"]);
  });

  it("所属が空欄の車両は「未設定」にまとめる", () => {
    const vehicles = aggregateByVehicle(
      new Map([["2026-05", [plRow({ no: "1", depot: "" })]]]),
    );

    expect(aggregateByDepot(vehicles)[0]?.depot).toBe("未設定");
  });
});

describe("monthBefore", () => {
  it("同一年内では月を1つ戻す", () => {
    expect(monthBefore("2026-05")).toBe("2026-04");
  });

  it("1月の1ヶ月前は前年12月になる (年またぎ)", () => {
    expect(monthBefore("2026-01")).toBe("2025-12");
  });
});

describe("diffRatio", () => {
  it("前期比の増減率を返す", () => {
    expect(diffRatio(120, 100)).toBeCloseTo(0.2, 10);
    expect(diffRatio(80, 100)).toBeCloseTo(-0.2, 10);
  });

  it("前期が0なら比較不能としてnullを返す", () => {
    expect(diffRatio(100, 0)).toBeNull();
  });

  it("前期が負値でも符号に引きずられない絶対値基準で返す (赤字→赤字縮小を+と出す)", () => {
    expect(diffRatio(-50, -100)).toBeCloseTo(0.5, 10);
  });
});
