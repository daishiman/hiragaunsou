import { describe, expect, it } from "vitest";
import {
  GetAnnualSummaryUseCase,
  RECONCILIATION_TOLERANCE,
} from "../../src/usecase/steps/getAnnualSummary";
import { plRow } from "../fixtures/vehiclePlRow";
import { stubAnnualReferenceRepo, stubVehiclePlRepo } from "../fixtures/stubRepositories";

describe("GetAnnualSummaryUseCase", () => {
  it("6月始まりの12ヶ月を昇順で組み立てる", async () => {
    const useCase = new GetAnnualSummaryUseCase(stubVehiclePlRepo({}), stubAnnualReferenceRepo());
    const res = await useCase.execute("2026-05");

    expect(res.fiscalYear).toBe(2025);
    expect(res.months).toHaveLength(12);
    expect(res.months[0]?.yearMonth).toBe("2025-06");
    expect(res.months[0]?.label).toBe("6月");
    expect(res.months[11]?.yearMonth).toBe("2026-05");
    expect(res.isEmpty).toBe(true);
  });

  it("取込済みの月だけ集計し、未取込の月は isEmpty で示す", async () => {
    const useCase = new GetAnnualSummaryUseCase(
      stubVehiclePlRepo({
        "2025-06": [plRow({ sales: 1_000_000, expense: 800_000, profit: 200_000, km: 5_000 })],
      }),
      stubAnnualReferenceRepo(),
    );
    const res = await useCase.execute("2026-05");

    expect(res.months[0]?.isEmpty).toBe(false);
    expect(res.months[1]?.isEmpty).toBe(true);
    expect(res.total.sales).toBe(1_000_000);
    expect(res.totalCostPerKm).toBe(160);
    expect(res.isEmpty).toBe(false);
  });

  it("前期実績があれば対前年の差分を出す", async () => {
    const useCase = new GetAnnualSummaryUseCase(
      stubVehiclePlRepo({
        "2025-06": [plRow({ sales: 1_200_000, expense: 1_000_000, profit: 200_000 })],
      }),
      stubAnnualReferenceRepo([
        { kind: "prev_year_actual", yearMonth: "2024-06", sales: 1_000_000, expense: 900_000, note: null },
      ]),
    );
    const res = await useCase.execute("2026-05");
    const june = res.comparison[0];

    expect(june?.prevSales).toBe(1_000_000);
    expect(june?.prevProfit).toBe(100_000);
    expect(june?.salesDiff).toBe(200_000);
    expect(june?.profitDiff).toBe(100_000);
    expect(res.comparisonPrevTotal?.sales).toBe(1_000_000);
  });

  it("前期実績が未登録の月は差分を null にする (0と書かない)", async () => {
    const useCase = new GetAnnualSummaryUseCase(stubVehiclePlRepo({}), stubAnnualReferenceRepo());
    const res = await useCase.execute("2026-05");

    expect(res.comparison[0]?.prevSales).toBeNull();
    expect(res.comparison[0]?.salesDiff).toBeNull();
    expect(res.comparisonPrevTotal).toBeNull();
  });

  it("現行Excel年間集計シートとの差が許容差を超えた月だけ要確認にする", async () => {
    const useCase = new GetAnnualSummaryUseCase(
      stubVehiclePlRepo({
        "2025-06": [plRow({ sales: 1_000_000, expense: 800_000, profit: 200_000 })],
        "2025-07": [plRow({ sales: 1_000_000, expense: 800_000, profit: 200_000 })],
      }),
      stubAnnualReferenceRepo([
        // 差 500円 (許容内)
        { kind: "excel_annual_sheet", yearMonth: "2025-06", sales: 999_500, expense: 800_000, note: null },
        // 差 50,000円 (要確認)
        { kind: "excel_annual_sheet", yearMonth: "2025-07", sales: 950_000, expense: 800_000, note: null },
      ]),
    );
    const res = await useCase.execute("2026-05");

    expect(RECONCILIATION_TOLERANCE).toBe(1000);
    expect(res.reconciliation[0]?.hasGap).toBe(false);
    expect(res.reconciliation[1]?.hasGap).toBe(true);
    expect(res.reconciliationGapCount).toBe(1);
  });

  it("シート値が無い月は突合対象にしない", async () => {
    const useCase = new GetAnnualSummaryUseCase(stubVehiclePlRepo({}), stubAnnualReferenceRepo());
    const res = await useCase.execute("2026-05");

    expect(res.reconciliation[0]?.sheetSales).toBeNull();
    expect(res.reconciliation[0]?.salesGap).toBeNull();
    expect(res.reconciliationGapCount).toBe(0);
  });
});
