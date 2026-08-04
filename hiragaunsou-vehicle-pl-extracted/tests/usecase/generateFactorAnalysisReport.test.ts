import { describe, expect, it, vi } from "vitest";
import { GenerateFactorAnalysisReportUseCase } from "../../src/usecase/steps/generateFactorAnalysisReport";
import type { VehiclePlRepository } from "../../src/domain/repositories/VehiclePlRepository";
import type { UsageLogRepository, UsageLogEntry } from "../../src/domain/repositories/UsageLogRepository";
import type {
  FactorAnalysisAiPort,
  FactorAnalysisReportInput,
} from "../../src/domain/services/FactorAnalysisAiPort";
import { calculateVehiclePl, type VehiclePlInput } from "../../src/domain/rules/vehiclePlCalculation";

function baseInput(overrides: Partial<VehiclePlInput> = {}): VehiclePlInput {
  return {
    no: "101",
    type: "4t",
    depot: "本社",
    reg: null,
    code: null,
    driver: "山田太郎",
    trips: 20,
    slips: 15,
    hours: 170,
    km: 6000,
    fare: 500000,
    fee: 5000,
    toll: 10000,
    fuelInQty: 50,
    fuelOutQty: 0,
    fuelOut: 0,
    adblue: 0,
    repairActual: 0,
    equip: 0,
    mainte: 0,
    salary: 300000,
    welfare: 40000,
    insCompulsory: 1000,
    insVoluntary: 2000,
    taxAuto: 500,
    taxWeight: 300,
    miscOther: 0,
    lease: 0,
    installment: 0,
    standardCostRate: { repairPerKm: 3.8, tirePerKm: 1.7 },
    ...overrides,
  };
}

function stubVehiclePlRepo(dataByYearMonth: Record<string, ReturnType<typeof calculateVehiclePl>[]>): VehiclePlRepository {
  return {
    upsertMany: async () => {},
    findByYearMonth: async (yearMonth) => dataByYearMonth[yearMonth] ?? [],
    findByVehicleNo: async () => [],
    findByYearMonths: async () => new Map(),
    countByYearMonth: async () => 0,
  };
}

describe("GenerateFactorAnalysisReportUseCase", () => {
  it("複数月の収支データをAIポートへ渡し、結果を利用量とともに記録する", async () => {
    const marchRows = [calculateVehiclePl(baseInput({ fare: 400000 }))];
    const aprilRows = [calculateVehiclePl(baseInput({ fare: 500000 }))];
    const vehiclePlRepo = stubVehiclePlRepo({ "2026-03": marchRows, "2026-04": aprilRows });

    const generateReport = vi.fn(async (_input: FactorAnalysisReportInput) => ({
      report: {
        summary: "4月は運賃収入が増加し増益となった。",
        keyDrivers: [
          { factor: "運賃収入", impact: "positive" as const, amountYen: 100000, explanation: "運賃単価上昇" },
        ],
        recommendations: ["高単価案件の比率を維持する"],
        lowConfidenceNotes: [],
      },
      usage: { model: "claude-haiku-4-5", inputTokens: 1200, outputTokens: 300 },
    }));
    const aiPort: FactorAnalysisAiPort = { generateReport };

    const recorded: UsageLogEntry[] = [];
    const usageLogRepo: UsageLogRepository = {
      record: async (entry) => {
        recorded.push(entry);
      },
    };

    const useCase = new GenerateFactorAnalysisReportUseCase(vehiclePlRepo, aiPort, usageLogRepo);

    const result = await useCase.execute({
      targetYearMonth: "2026-04",
      compareYearMonths: ["2026-03"],
      requestedBy: "user@example.com",
    });

    expect(result.monthsAnalyzed).toEqual(["2026-03", "2026-04"]);
    expect(result.report.summary).toContain("増益");

    expect(generateReport).toHaveBeenCalledTimes(1);
    const calledWith = generateReport.mock.calls[0]?.[0];
    expect(calledWith?.targetYearMonth).toBe("2026-04");
    expect(calledWith?.months.map((m) => m.yearMonth)).toEqual(["2026-03", "2026-04"]);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.kind).toBe("factor_analysis_report");
    expect(recorded[0]?.model).toBe("claude-haiku-4-5");
    expect(recorded[0]?.inputTokens).toBe(1200);
    expect(recorded[0]?.recordedBy).toBe("user@example.com");
  });

  it("データが1件もない月は比較対象から除外し、全月データなしならエラーにする", async () => {
    const vehiclePlRepo = stubVehiclePlRepo({});
    const aiPort: FactorAnalysisAiPort = { generateReport: vi.fn() };
    const usageLogRepo: UsageLogRepository = { record: vi.fn() };

    const useCase = new GenerateFactorAnalysisReportUseCase(vehiclePlRepo, aiPort, usageLogRepo);

    await expect(
      useCase.execute({ targetYearMonth: "2026-04", compareYearMonths: ["2026-03"], requestedBy: null }),
    ).rejects.toThrow(/収支確定済みデータ/);
  });
});
