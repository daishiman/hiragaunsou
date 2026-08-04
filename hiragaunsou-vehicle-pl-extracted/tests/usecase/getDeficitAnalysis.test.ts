import { describe, expect, it } from "vitest";
import { GetDeficitAnalysisUseCase } from "../../src/usecase/steps/getDeficitAnalysis";
import { plRow } from "../fixtures/vehiclePlRow";
import { stubRateMasterRepo, stubVehiclePlRepo } from "../fixtures/stubRepositories";

const rows = [
  plRow({ no: "101", sales: 1_500_000, expense: 1_700_000, profit: -200_000, repair: 400_000, km: 8_000, fixed: 300_000 }),
  plRow({ no: "102", sales: 1_200_000, expense: 1_350_000, profit: -150_000, repair: 10_000, km: 10_000, fixed: 300_000 }),
  plRow({ no: "103", sales: 50_000, expense: 400_000, profit: -350_000, repair: 0, km: 200, fixed: 300_000 }),
  plRow({ no: "104", sales: 2_000_000, expense: 1_700_000, profit: 300_000, km: 10_000 }),
];

describe("GetDeficitAnalysisUseCase", () => {
  it("赤字車を突発修繕型・単価効率型・遊休型の3グループに振り分ける", async () => {
    const useCase = new GetDeficitAnalysisUseCase(
      stubVehiclePlRepo({ "2026-05": rows }),
      stubRateMasterRepo(),
    );
    const res = await useCase.execute("2026-05");

    const byCategory = Object.fromEntries(
      res.groups.map((g) => [g.category, g.vehicles.map((v) => v.vehicleNo)]),
    );
    expect(byCategory.repair).toEqual(["101"]);
    expect(byCategory.price).toEqual(["102"]);
    expect(byCategory.idle).toEqual(["103"]);
  });

  it("黒字車は含めず、赤字台数と損失合計を出す", async () => {
    const useCase = new GetDeficitAnalysisUseCase(
      stubVehiclePlRepo({ "2026-05": rows }),
      stubRateMasterRepo(),
    );
    const res = await useCase.execute("2026-05");

    expect(res.deficitCount).toBe(3);
    expect(res.lossTotal).toBe(-700_000);
  });

  it("各グループは損失の大きい順に並ぶ (打ち手の優先順位)", async () => {
    const useCase = new GetDeficitAnalysisUseCase(
      stubVehiclePlRepo({
        "2026-05": [
          plRow({ no: "A", sales: 1_500_000, profit: -100_000, repair: 10_000, km: 10_000 }),
          plRow({ no: "B", sales: 1_500_000, profit: -500_000, repair: 10_000, km: 10_000 }),
        ],
      }),
      stubRateMasterRepo(),
    );
    const res = await useCase.execute("2026-05");
    const price = res.groups.find((g) => g.category === "price");
    expect(price?.vehicles.map((v) => v.vehicleNo)).toEqual(["B", "A"]);
  });

  it("分類ごとの見出し・打ち手・注目列が付く", async () => {
    const useCase = new GetDeficitAnalysisUseCase(
      stubVehiclePlRepo({ "2026-05": rows }),
      stubRateMasterRepo(),
    );
    const res = await useCase.execute("2026-05");
    const repair = res.groups.find((g) => g.category === "repair");
    expect(repair?.title).toBe("突発修繕型");
    expect(repair?.extraColumnLabel).toBe("修理費(実費)");
    expect(repair?.action).not.toBe("");
  });

  it("データが無い月は空状態として返す", async () => {
    const useCase = new GetDeficitAnalysisUseCase(stubVehiclePlRepo({}), stubRateMasterRepo());
    const res = await useCase.execute("2026-06");
    expect(res.isEmpty).toBe(true);
    expect(res.deficitCount).toBe(0);
  });
});
