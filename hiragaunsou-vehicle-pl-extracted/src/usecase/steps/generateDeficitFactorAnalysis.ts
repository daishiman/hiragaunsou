import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { UsageLogRepository } from "../../domain/repositories/UsageLogRepository";
import type {
  DeficitFactorAnalysisRecord,
  DeficitFactorAnalysisRepository,
} from "../../domain/repositories/DeficitFactorAnalysisRepository";
import type { DeficitFactorAnalysisAiPort } from "../../domain/services/DeficitFactorAnalysisAiPort";
import { classifyDeficit, DEFICIT_CATEGORY_ORDER, type DeficitCategory } from "../../domain/rules/deficitClassification";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";

/**
 * S9 赤字の理由(3分類)画面の「AI分析する」ボタンから起動するユースケース。
 *
 * 対象月の赤字車両を月単位でまとめて1回のAI呼び出しに渡し(レコード単位で呼ばず
 * レート制限・コストを抑える設計)、結果をD1にキャッシュする。
 * 既に分析済みの車両はAIを再呼び出しせず、未分析の車両だけを対象にする。
 */
export interface GenerateDeficitFactorAnalysisInput {
  yearMonth: string;
  requestedBy: string | null;
}

export interface GenerateDeficitFactorAnalysisResult {
  results: DeficitFactorAnalysisRecord[];
  /** 今回AI呼び出しの対象になった(=未分析だった)車両数 */
  analyzedCount: number;
}

const USAGE_KIND = "deficit_factor_analysis";

export class GenerateDeficitFactorAnalysisUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly analysisRepo: DeficitFactorAnalysisRepository,
    private readonly aiPort: DeficitFactorAnalysisAiPort,
    private readonly usageLogRepo: UsageLogRepository,
  ) {}

  async execute(input: GenerateDeficitFactorAnalysisInput): Promise<GenerateDeficitFactorAnalysisResult> {
    const rows = await this.vehiclePlRepo.findByYearMonth(input.yearMonth);
    const groups = classifyDeficit(rows);
    const deficitVehicles: { vehicle: VehiclePlCalculated; ruleCategory: DeficitCategory }[] =
      DEFICIT_CATEGORY_ORDER.flatMap((category) =>
        groups[category].map((vehicle) => ({ vehicle, ruleCategory: category })),
      );

    const existing = await this.analysisRepo.findByYearMonth(input.yearMonth);
    const analyzedVehicleNos = new Set(existing.map((r) => r.vehicleNo));
    const targets = deficitVehicles.filter((t) => !analyzedVehicleNos.has(t.vehicle.no));

    if (targets.length === 0) {
      return { results: existing, analyzedCount: 0 };
    }

    const { results, usage } = await this.aiPort.analyze({ yearMonth: input.yearMonth, targets });

    await this.usageLogRepo.record({
      kind: USAGE_KIND,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      recordedBy: input.requestedBy,
      detail: { yearMonth: input.yearMonth, vehicleCount: targets.length },
    });

    await this.analysisRepo.upsertMany(
      results.map((r) => ({
        vehicleNo: r.vehicleNo,
        yearMonth: input.yearMonth,
        summary: r.summary,
        factors: r.factors,
        model: usage.model,
      })),
      input.requestedBy,
    );

    const merged = await this.analysisRepo.findByYearMonth(input.yearMonth);
    return { results: merged, analyzedCount: targets.length };
  }
}
