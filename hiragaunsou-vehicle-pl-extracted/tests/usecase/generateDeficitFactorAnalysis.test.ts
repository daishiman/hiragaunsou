import { describe, expect, it, vi } from "vitest";
import { GenerateDeficitFactorAnalysisUseCase } from "../../src/usecase/steps/generateDeficitFactorAnalysis";
import type { VehiclePlRepository } from "../../src/domain/repositories/VehiclePlRepository";
import type { UsageLogRepository, UsageLogEntry } from "../../src/domain/repositories/UsageLogRepository";
import type {
  DeficitFactorAnalysisRecord,
  DeficitFactorAnalysisRepository,
  DeficitFactorAnalysisUpsertInput,
} from "../../src/domain/repositories/DeficitFactorAnalysisRepository";
import type {
  DeficitFactorAnalysisAiPort,
  DeficitFactorAnalysisInput,
} from "../../src/domain/services/DeficitFactorAnalysisAiPort";
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
    fare: 100000,
    fee: 0,
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

function stubVehiclePlRepo(rows: ReturnType<typeof calculateVehiclePl>[]): VehiclePlRepository {
  return {
    upsertMany: async () => {},
    findByYearMonth: async () => rows,
    findByVehicleNo: async () => [],
    findByYearMonths: async () => new Map(),
    countByYearMonth: async () => rows.length,
    getConfirmation: async () => ({ total: rows.length, confirmed: 0 }),
    setConfirmed: async () => {},
  };
}

function fakeAnalysisRepo(): DeficitFactorAnalysisRepository & {
  rows: Map<string, DeficitFactorAnalysisRecord>;
} {
  const rows = new Map<string, DeficitFactorAnalysisRecord>();
  return {
    rows,
    async findByYearMonth(yearMonth) {
      return [...rows.values()].filter((r) => r.yearMonth === yearMonth);
    },
    async findOne(vehicleNo, yearMonth) {
      return rows.get(`${yearMonth}:${vehicleNo}`) ?? null;
    },
    async upsertMany(inputs: DeficitFactorAnalysisUpsertInput[]) {
      for (const input of inputs) {
        rows.set(`${input.yearMonth}:${input.vehicleNo}`, { ...input, updatedAt: 0 });
      }
    },
  };
}

describe("GenerateDeficitFactorAnalysisUseCase", () => {
  it("赤字車両だけをAIポートへまとめて渡し、結果を永続化する", async () => {
    const profitableRow = calculateVehiclePl(baseInput({ no: "1", fare: 900000 }));
    const deficitRow = calculateVehiclePl(baseInput({ no: "2", fare: 50000 }));
    const vehiclePlRepo = stubVehiclePlRepo([profitableRow, deficitRow]);
    const analysisRepo = fakeAnalysisRepo();

    const analyze = vi.fn(async (_input: DeficitFactorAnalysisInput) => ({
      results: [
        {
          vehicleNo: "2",
          summary: "燃料費が高く赤字",
          factors: [
            { category: "fuelTotal" as const, direction: "high" as const, amountYen: 30000, explanation: "他車平均より高い" },
          ],
        },
      ],
      usage: { model: "claude-haiku-4-5", inputTokens: 500, outputTokens: 100 },
    }));
    const aiPort: DeficitFactorAnalysisAiPort = { analyze };

    const recorded: UsageLogEntry[] = [];
    const usageLogRepo: UsageLogRepository = {
      record: async (entry) => {
        recorded.push(entry);
      },
    };

    const useCase = new GenerateDeficitFactorAnalysisUseCase(vehiclePlRepo, analysisRepo, aiPort, usageLogRepo);
    const result = await useCase.execute({ yearMonth: "2026-05", requestedBy: "user-1" });

    expect(analyze).toHaveBeenCalledTimes(1);
    const calledWith = analyze.mock.calls[0]?.[0];
    expect(calledWith?.targets).toHaveLength(1);
    expect(calledWith?.targets[0]?.vehicle.no).toBe("2");

    expect(result.analyzedCount).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.summary).toBe("燃料費が高く赤字");

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.kind).toBe("deficit_factor_analysis");
    expect(recorded[0]?.recordedBy).toBe("user-1");
  });

  it("既に分析済みの車両はAIを再度呼び出さない", async () => {
    const deficitRow = calculateVehiclePl(baseInput({ no: "2", fare: 50000 }));
    const vehiclePlRepo = stubVehiclePlRepo([deficitRow]);
    const analysisRepo = fakeAnalysisRepo();
    await analysisRepo.upsertMany(
      [{ vehicleNo: "2", yearMonth: "2026-05", summary: "既存の分析", factors: [], model: "claude-haiku-4-5" }],
      null,
    );

    const analyze = vi.fn();
    const aiPort: DeficitFactorAnalysisAiPort = { analyze };
    const usageLogRepo: UsageLogRepository = { record: vi.fn() };

    const useCase = new GenerateDeficitFactorAnalysisUseCase(vehiclePlRepo, analysisRepo, aiPort, usageLogRepo);
    const result = await useCase.execute({ yearMonth: "2026-05", requestedBy: null });

    expect(analyze).not.toHaveBeenCalled();
    expect(result.analyzedCount).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.summary).toBe("既存の分析");
  });
});
