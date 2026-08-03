import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { UsageLogRepository } from "../../domain/repositories/UsageLogRepository";
import type { FactorAnalysisAiPort, FactorAnalysisReport } from "../../domain/services/FactorAnalysisAiPort";

/**
 * F: AI要因分析レポート生成ユースケース。
 *
 * D1に蓄積された複数月分の車両別収支表(vehicle_pl)を材料に、
 * FactorAnalysisAiPort(Claude API実装をInfrastructure層に配置)へ分析を委譲する。
 * 「AIは判別/抽出/説明生成にだけ使う」「利用量は全件記録する」という
 * llm-api-integrationスキルの規律に従い、呼び出し1回ごとにUsageLogRepositoryへ記録する。
 */
export interface GenerateFactorAnalysisReportInput {
  targetYearMonth: string;
  /** 比較対象の過去月(古い→新しい順)。targetYearMonthは含めない */
  compareYearMonths: string[];
  requestedBy: string | null;
}

export interface GenerateFactorAnalysisReportResult {
  report: FactorAnalysisReport;
  monthsAnalyzed: string[];
}

const USAGE_KIND = "factor_analysis_report";

export class GenerateFactorAnalysisReportUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly aiPort: FactorAnalysisAiPort,
    private readonly usageLogRepo: UsageLogRepository,
  ) {}

  async execute(input: GenerateFactorAnalysisReportInput): Promise<GenerateFactorAnalysisReportResult> {
    const orderedYearMonths = [...input.compareYearMonths, input.targetYearMonth];

    const months = await Promise.all(
      orderedYearMonths.map(async (yearMonth) => ({
        yearMonth,
        vehicles: await this.vehiclePlRepo.findByYearMonth(yearMonth),
      })),
    );

    const monthsWithData = months.filter((m) => m.vehicles.length > 0);
    if (monthsWithData.length === 0) {
      throw new Error(`収支確定済みデータが1件もありません(対象: ${orderedYearMonths.join(", ")})`);
    }

    const { report, usage } = await this.aiPort.generateReport({
      targetYearMonth: input.targetYearMonth,
      months: monthsWithData,
    });

    await this.usageLogRepo.record({
      kind: USAGE_KIND,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      recordedBy: input.requestedBy,
      detail: {
        targetYearMonth: input.targetYearMonth,
        monthsAnalyzed: monthsWithData.map((m) => m.yearMonth),
      },
    });

    return { report, monthsAnalyzed: monthsWithData.map((m) => m.yearMonth) };
  }
}
