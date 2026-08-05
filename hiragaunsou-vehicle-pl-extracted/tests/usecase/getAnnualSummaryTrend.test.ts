import { describe, expect, it } from "vitest";
import { GetAnnualSummaryUseCase, TREND_MONTH_COUNT } from "../../src/usecase/steps/getAnnualSummary";
import { plRow } from "../fixtures/vehiclePlRow";
import { stubAnnualReferenceRepo, stubVehiclePlRepo } from "../fixtures/stubRepositories";

describe("GetAnnualSummaryUseCase の推移グラフ用データ", () => {
  it("会計期ではなく対象月を含む直近13ヶ月を昇順で返す", async () => {
    const useCase = new GetAnnualSummaryUseCase(stubVehiclePlRepo({}), stubAnnualReferenceRepo());
    const res = await useCase.execute("2026-08");

    expect(TREND_MONTH_COUNT).toBe(13);
    expect(res.trend).toHaveLength(13);
    // 1年前の同月から当月まで
    expect(res.trend[0]?.yearMonth).toBe("2025-08");
    expect(res.trend[12]?.yearMonth).toBe("2026-08");
  });

  it("年をまたいでも先頭と末尾を区別できるラベルを付ける", async () => {
    const useCase = new GetAnnualSummaryUseCase(stubVehiclePlRepo({}), stubAnnualReferenceRepo());
    const res = await useCase.execute("2026-08");

    expect(res.trend[0]?.label).toBe("25/8");
    expect(res.trend[12]?.label).toBe("26/8");
    expect(res.trend[0]?.label).not.toBe(res.trend[12]?.label);
  });

  it("前年同月の比較値を vehicle_pl の実績から引く", async () => {
    const useCase = new GetAnnualSummaryUseCase(
      stubVehiclePlRepo({
        "2026-08": [plRow({ sales: 2_000_000, expense: 1_500_000, profit: 500_000 })],
        "2025-08": [plRow({ sales: 1_000_000, expense: 900_000, profit: 100_000 })],
      }),
      stubAnnualReferenceRepo(),
    );
    const res = await useCase.execute("2026-08");

    const current = res.trend[12];
    expect(current).toMatchObject({
      yearMonth: "2026-08",
      sales: 2_000_000,
      profit: 500_000,
      prevSales: 1_000_000,
      prevProfit: 100_000,
      isEmpty: false,
    });
  });

  it("前年同月が未取込なら比較値を null にする", async () => {
    const useCase = new GetAnnualSummaryUseCase(
      stubVehiclePlRepo({
        "2026-08": [plRow({ sales: 2_000_000, expense: 1_500_000, profit: 500_000 })],
      }),
      stubAnnualReferenceRepo(),
    );
    const res = await useCase.execute("2026-08");

    expect(res.trend[12]).toMatchObject({ prevSales: null, prevProfit: null, isEmpty: false });
  });

  it("未取込の月は isEmpty で示し、0円の実績と区別する", async () => {
    const useCase = new GetAnnualSummaryUseCase(stubVehiclePlRepo({}), stubAnnualReferenceRepo());
    const res = await useCase.execute("2026-08");

    expect(res.trend.every((t) => t.isEmpty)).toBe(true);
  });

  it("会計期12ヶ月の months は従来どおり据え置く", async () => {
    const useCase = new GetAnnualSummaryUseCase(stubVehiclePlRepo({}), stubAnnualReferenceRepo());
    const res = await useCase.execute("2026-08");

    expect(res.months).toHaveLength(12);
    expect(res.months[0]?.yearMonth).toBe("2026-06");
    expect(res.months[11]?.yearMonth).toBe("2027-05");
    expect(res.months[0]?.label).toBe("6月");
  });
});
