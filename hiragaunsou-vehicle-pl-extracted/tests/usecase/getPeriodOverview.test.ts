import { describe, expect, it } from "vitest";
import { GetPeriodOverviewUseCase } from "../../src/usecase/steps/getPeriodOverview";
import { plRow } from "../fixtures/vehiclePlRow";
import { stubAnnualReferenceRepo, stubRateMasterRepo, stubVehiclePlRepo } from "../fixtures/stubRepositories";

describe("GetPeriodOverviewUseCase", () => {
  function useCase(
    byMonth: Record<string, ReturnType<typeof plRow>[]>,
    refs: Parameters<typeof stubAnnualReferenceRepo>[0] = [],
  ) {
    return new GetPeriodOverviewUseCase(
      stubVehiclePlRepo(byMonth),
      stubRateMasterRepo(),
      stubAnnualReferenceRepo(refs),
    );
  }

  it("複数月を横断して全社の合計を出す", async () => {
    const res = await useCase({
      "2026-04": [plRow({ no: "1", sales: 1_000_000, expense: 900_000, profit: 100_000, km: 5_000 })],
      "2026-05": [plRow({ no: "1", sales: 1_200_000, expense: 1_000_000, profit: 200_000, km: 6_000 })],
    }).execute("2026-04", "2026-05");

    expect(res.yearMonths).toEqual(["2026-04", "2026-05"]);
    expect(res.totals.sales).toBe(2_200_000);
    expect(res.totals.profit).toBe(300_000);
    expect(res.totals.km).toBe(11_000);
    expect(res.isEmpty).toBe(false);
  });

  it("月次推移を昇順で返し、データの無い月も欠番にせず0で並べる", async () => {
    const res = await useCase({
      "2026-04": [plRow({ no: "1", sales: 1_000_000 })],
    }).execute("2026-04", "2026-06");

    expect(res.months.map((m) => m.yearMonth)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(res.months[0]?.isEmpty).toBe(false);
    expect(res.months[1]?.isEmpty).toBe(true);
    expect(res.months[1]?.totals.sales).toBe(0);
  });

  it("赤字車両を損失の大きい順に並べる", async () => {
    const res = await useCase({
      "2026-05": [
        plRow({ no: "1", profit: 100_000 }),
        plRow({ no: "2", profit: -50_000 }),
        plRow({ no: "3", profit: -400_000 }),
      ],
    }).execute("2026-05", "2026-05");

    expect(res.deficitRanking.map((v) => v.vehicleNo)).toEqual(["3", "2"]);
    expect(res.deficitCount).toBe(2);
    expect(res.vehicleCount).toBe(3);
  });

  it("営業所別に集計する", async () => {
    const res = await useCase({
      "2026-05": [
        plRow({ no: "1", depot: "本社", sales: 1_000_000, profit: 100_000 }),
        plRow({ no: "2", depot: "北営業所", sales: 400_000, profit: -20_000 }),
      ],
    }).execute("2026-05", "2026-05");

    expect(res.depots.map((d) => d.depot)).toEqual(["本社", "北営業所"]);
    expect(res.depots[1]?.deficitCars).toBe(1);
  });

  it("経費構成を金額の大きい順に返す", async () => {
    const res = await useCase({
      "2026-05": [
        plRow({ no: "1", expense: 500_000, laborTotal: 300_000, fuelTotal: 200_000 }),
      ],
    }).execute("2026-05", "2026-05");

    expect(res.costSlices[0]?.label).toBe("人件費");
    expect(res.costSlices[0]?.share).toBeCloseTo(0.6, 10);
  });

  it("前年同期の実績が収支表にあれば、それを対前年の相手にする", async () => {
    const res = await useCase({
      "2025-05": [plRow({ no: "1", sales: 1_000_000, expense: 800_000, profit: 200_000 })],
      "2026-05": [plRow({ no: "1", sales: 1_200_000, expense: 900_000, profit: 300_000 })],
    }).execute("2026-05", "2026-05");

    expect(res.prev?.source).toBe("actual");
    expect(res.prev?.sales).toBe(1_000_000);
    expect(res.salesDiffRatio).toBeCloseTo(0.2, 10);
    expect(res.profitDiffRatio).toBeCloseTo(0.5, 10);
  });

  it("収支表に前年が無ければ年間集計の前年実績で補う", async () => {
    const res = await useCase(
      { "2026-05": [plRow({ no: "1", sales: 1_200_000, expense: 900_000, profit: 300_000 })] },
      [{ kind: "prev_year_actual", yearMonth: "2025-05", sales: 1_000_000, expense: 800_000, note: null }],
    ).execute("2026-05", "2026-05");

    expect(res.prev?.source).toBe("reference");
    expect(res.prev?.sales).toBe(1_000_000);
    expect(res.prev?.profit).toBe(200_000);
  });

  it("前年のデータがどこにも無ければ対前年をnullにする (0扱いで伸び率を捏造しない)", async () => {
    const res = await useCase({
      "2026-05": [plRow({ no: "1", sales: 1_200_000 })],
    }).execute("2026-05", "2026-05");

    expect(res.prev).toBeNull();
    expect(res.salesDiffRatio).toBeNull();
    expect(res.profitDiffRatio).toBeNull();
  });

  it("データが1件も無い期間は空状態として返す", async () => {
    const res = await useCase({}).execute("2026-04", "2026-06");

    expect(res.isEmpty).toBe(true);
    expect(res.totals.sales).toBe(0);
    expect(res.deficitRanking).toEqual([]);
    expect(res.depots).toEqual([]);
  });

  it("開始が終了より後でも例外にせず空状態にする", async () => {
    const res = await useCase({ "2026-05": [plRow({ no: "1", sales: 1 })] }).execute("2026-06", "2026-04");

    expect(res.yearMonths).toEqual([]);
    expect(res.isEmpty).toBe(true);
  });
});
