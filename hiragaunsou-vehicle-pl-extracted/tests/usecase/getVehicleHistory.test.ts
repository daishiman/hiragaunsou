import { describe, expect, it } from "vitest";
import { GetVehicleHistoryUseCase, HISTORY_MONTHS } from "../../src/usecase/steps/getVehicleHistory";
import { plRow } from "../fixtures/vehiclePlRow";
import { stubVehiclePlRepo } from "../fixtures/stubRepositories";

describe("GetVehicleHistoryUseCase", () => {
  it("対象月を末尾に含む12ヶ月の推移を返す", async () => {
    const useCase = new GetVehicleHistoryUseCase(stubVehiclePlRepo({}));
    const res = await useCase.execute("101", "2026-05");

    expect(res.history).toHaveLength(HISTORY_MONTHS);
    expect(res.history[0]?.yearMonth).toBe("2025-06");
    expect(res.history[11]?.yearMonth).toBe("2026-05");
    expect(res.found).toBe(false);
    expect(res.normalizedProfit).toBeNull();
  });

  it("実力損益は修理費を存在月の平均に均して算出する", async () => {
    const useCase = new GetVehicleHistoryUseCase(
      stubVehiclePlRepo({
        "2026-03": [plRow({ no: "101", repair: 0, profit: 100_000 })],
        "2026-04": [plRow({ no: "101", repair: 0, profit: 100_000 })],
        "2026-05": [plRow({ no: "101", repair: 300_000, profit: -200_000 })],
      }),
      );
    const res = await useCase.execute("101", "2026-05");

    // データのある3ヶ月の平均 = 100,000 円 (未取込の9ヶ月を0円として薄めない)
    expect(res.avgRepair).toBe(100_000);
    expect(res.normalizedProfit).toBe(0); // -200,000 + 300,000 - 100,000
  });

  it("他車両の行は混ぜない", async () => {
    const useCase = new GetVehicleHistoryUseCase(
      stubVehiclePlRepo({
        "2026-05": [plRow({ no: "101", sales: 100 }), plRow({ no: "202", sales: 999 })],
      }),
    );
    const res = await useCase.execute("101", "2026-05");

    expect(res.found).toBe(true);
    expect(res.history[11]?.sales).toBe(100);
  });

  it("経費内訳は年間集計と同じ8区分で返す", async () => {
    const useCase = new GetVehicleHistoryUseCase(
      stubVehiclePlRepo({ "2026-05": [plRow({ no: "101", fuelTotal: 250_000 })] }),
    );
    const res = await useCase.execute("101", "2026-05");

    expect(res.costBreakdown).toHaveLength(8);
    expect(res.costBreakdown.map((c) => c.label)).toEqual([
      "運行費",
      "燃料費",
      "修繕費",
      "人件費",
      "保険料",
      "賦課税",
      "運送費",
      "一般管理費",
    ]);
    expect(res.costBreakdown.find((c) => c.key === "fuelTotal")?.value).toBe(250_000);
  });
});
