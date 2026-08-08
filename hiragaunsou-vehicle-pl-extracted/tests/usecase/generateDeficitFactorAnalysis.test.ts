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
import { stubRateMasterRepo } from "../fixtures/stubRepositories";

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

    const useCase = new GenerateDeficitFactorAnalysisUseCase(
      vehiclePlRepo,
      analysisRepo,
      aiPort,
      usageLogRepo,
      stubRateMasterRepo(),
    );
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

  it("既に分析済みで損益も変わっていない車両はAIを再度呼び出さない", async () => {
    const deficitRow = calculateVehiclePl(baseInput({ no: "2", fare: 50000 }));
    const vehiclePlRepo = stubVehiclePlRepo([deficitRow]);
    const analysisRepo = fakeAnalysisRepo();
    await analysisRepo.upsertMany(
      [
        {
          vehicleNo: "2",
          yearMonth: "2026-05",
          summary: "既存の分析",
          factors: [],
          model: "claude-haiku-4-5",
          profitAtAnalysis: deficitRow.profit,
        },
      ],
      null,
    );

    const analyze = vi.fn();
    const aiPort: DeficitFactorAnalysisAiPort = { analyze };
    const usageLogRepo: UsageLogRepository = { record: vi.fn() };

    const useCase = new GenerateDeficitFactorAnalysisUseCase(
      vehiclePlRepo,
      analysisRepo,
      aiPort,
      usageLogRepo,
      stubRateMasterRepo(),
    );
    const result = await useCase.execute({ yearMonth: "2026-05", requestedBy: null });

    expect(analyze).not.toHaveBeenCalled();
    expect(result.analyzedCount).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.summary).toBe("既存の分析");
  });

  /**
   * 率マスタの改定や手入力の修正で損益が動いたときの回帰。
   * 分析文は損益を根拠に書かれているので、根拠が変わったのに文が残るのは誤情報になる。
   */
  it("分析済みでも損益が動いた車両は分析し直す", async () => {
    const deficitRow = calculateVehiclePl(baseInput({ no: "2", fare: 50000 }));
    const vehiclePlRepo = stubVehiclePlRepo([deficitRow]);
    const analysisRepo = fakeAnalysisRepo();
    await analysisRepo.upsertMany(
      [
        {
          vehicleNo: "2",
          yearMonth: "2026-05",
          summary: "率が古かった頃の分析",
          factors: [],
          model: "claude-haiku-4-5",
          // 一般管理費率が上がる前の損益。現在値より赤字が浅い。
          profitAtAnalysis: deficitRow.profit + 50000,
        },
      ],
      null,
    );

    const analyze = vi.fn(async (_input: DeficitFactorAnalysisInput) => ({
      results: [{ vehicleNo: "2", summary: "新しい分析", factors: [] }],
      usage: { model: "claude-haiku-4-5", inputTokens: 100, outputTokens: 50 },
    }));
    const aiPort: DeficitFactorAnalysisAiPort = { analyze };
    const usageLogRepo: UsageLogRepository = { record: vi.fn() };

    const useCase = new GenerateDeficitFactorAnalysisUseCase(
      vehiclePlRepo,
      analysisRepo,
      aiPort,
      usageLogRepo,
      stubRateMasterRepo(),
    );
    const result = await useCase.execute({ yearMonth: "2026-05", requestedBy: null });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.analyzedCount).toBe(1);
    expect(result.results[0]?.summary).toBe("新しい分析");
    // 次回の判定材料として現在の損益が保存されていること
    expect(result.results[0]?.profitAtAnalysis).toBeCloseTo(deficitRow.profit, 2);
  });

  /** 列を追加する前に作られたレコードは陳腐化を判定できないので、信用せず分析し直す。 */
  it("分析時の損益が記録されていない古いレコードは分析し直す", async () => {
    const deficitRow = calculateVehiclePl(baseInput({ no: "2", fare: 50000 }));
    const analysisRepo = fakeAnalysisRepo();
    analysisRepo.rows.set("2026-05:2", {
      vehicleNo: "2",
      yearMonth: "2026-05",
      summary: "列追加前の分析",
      factors: [],
      model: "claude-haiku-4-5",
      profitAtAnalysis: null,
      updatedAt: 0,
    });

    const analyze = vi.fn(async (_input: DeficitFactorAnalysisInput) => ({
      results: [{ vehicleNo: "2", summary: "新しい分析", factors: [] }],
      usage: { model: "claude-haiku-4-5", inputTokens: 100, outputTokens: 50 },
    }));

    const useCase = new GenerateDeficitFactorAnalysisUseCase(
      stubVehiclePlRepo([deficitRow]),
      analysisRepo,
      { analyze },
      { record: vi.fn() },
      stubRateMasterRepo(),
    );
    const result = await useCase.execute({ yearMonth: "2026-05", requestedBy: null });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.analyzedCount).toBe(1);
  });

  /**
   * P3-10 の回帰。閾値引数を省くと DEFAULT_DEFICIT_THRESHOLDS が黙って使われ、
   * 「閾値は rate_master から差し替える」という設計が呼び出し側だけで無効になる。
   */
  it("赤字3分類の閾値を rate_master から取る", async () => {
    // 売上10万円の赤字車。既定の idleSales=30万なら「遊休型」だが、
    // マスタで5万円に下げれば「単価・効率型」に変わる。
    const deficitRow = calculateVehiclePl(baseInput({ no: "2", fare: 100000 }));

    const analyze = vi.fn(async (_input: DeficitFactorAnalysisInput) => ({
      results: [{ vehicleNo: "2", summary: "分析", factors: [] }],
      usage: { model: "claude-haiku-4-5", inputTokens: 100, outputTokens: 50 },
    }));

    const useCase = new GenerateDeficitFactorAnalysisUseCase(
      stubVehiclePlRepo([deficitRow]),
      fakeAnalysisRepo(),
      { analyze },
      { record: vi.fn() },
      stubRateMasterRepo({ idleSales: 50000 }),
    );
    await useCase.execute({ yearMonth: "2026-05", requestedBy: null });

    expect(analyze.mock.calls[0]?.[0].targets[0]?.ruleCategory).toBe("price");
  });
});
