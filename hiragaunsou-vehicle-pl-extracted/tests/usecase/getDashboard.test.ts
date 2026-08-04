import { describe, expect, it } from "vitest";
import { GetDashboardUseCase } from "../../src/usecase/steps/getDashboard";
import { plRow } from "../fixtures/vehiclePlRow";
import { stubRateMasterRepo, stubVehiclePlRepo } from "../fixtures/stubRepositories";

describe("GetDashboardUseCase", () => {
  it("全社KPI(売上・損益・利益率・1km原価/売上)を組み立てる", async () => {
    const useCase = new GetDashboardUseCase(
      stubVehiclePlRepo({
        "2026-05": [
          plRow({ no: "1", sales: 2_000_000, expense: 1_700_000, profit: 300_000, km: 10_000 }),
        ],
      }),
      stubRateMasterRepo(),
    );
    const res = await useCase.execute("2026-05");

    expect(res.totals.sales).toBe(2_000_000);
    expect(res.totals.profit).toBe(300_000);
    expect(res.margin).toBeCloseTo(0.15, 10);
    expect(res.costPerKm).toBe(170);
    expect(res.salesPerKm).toBe(200);
    expect(res.isEmpty).toBe(false);
  });

  it("閾値は率マスタから読み、km単価分布の損益分岐に反映する", async () => {
    const useCase = new GetDashboardUseCase(
      stubVehiclePlRepo({ "2026-05": [plRow({ no: "1", km: 10_000, sales: 1_400_000 })] }),
      stubRateMasterRepo({ breakEvenKmPrice: 150 }),
    );
    const res = await useCase.execute("2026-05");

    expect(res.thresholds.breakEvenKmPrice).toBe(150);
    const below = res.kmPriceBuckets.filter((b) => b.belowBreakEven).map((b) => b.label);
    expect(below).toEqual(["130円未満", "130〜150円"]);
  });

  it("データが無い月は空状態として返す (ゼロ埋めの集計付き)", async () => {
    const useCase = new GetDashboardUseCase(stubVehiclePlRepo({}), stubRateMasterRepo());
    const res = await useCase.execute("2026-06");

    expect(res.isEmpty).toBe(true);
    expect(res.totals.cars).toBe(0);
    expect(res.margin).toBeNull();
  });
});
