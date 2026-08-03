import type { VehiclePlCalculated } from "../rules/vehiclePlCalculation";

/** 1ヶ月分の車両別収支表(要因分析の材料)。 */
export interface MonthlyFleetSummary {
  yearMonth: string;
  vehicles: VehiclePlCalculated[];
}

/** 対象月 + 比較用の過去数ヶ月分(古い→新しい順、targetYearMonthを含む)。 */
export interface FactorAnalysisReportInput {
  targetYearMonth: string;
  months: MonthlyFleetSummary[];
}

export interface FactorAnalysisDriver {
  factor: string;
  impact: "positive" | "negative";
  amountYen: number;
  explanation: string;
}

export interface FactorAnalysisReport {
  summary: string;
  keyDrivers: FactorAnalysisDriver[];
  recommendations: string[];
  /** AIが十分な根拠を持てなかった論点(推測で断定させない代わりに正直に列挙させる) */
  lowConfidenceNotes: string[];
}

export interface FactorAnalysisUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * 複数月の車両別収支表から損益要因を分析するAIポート(Domain層のインターフェース)。
 * 実装(Claude API等)はInfrastructure層に置き、依存性逆転でUseCaseから呼ばれる。
 */
export interface FactorAnalysisAiPort {
  generateReport(
    input: FactorAnalysisReportInput,
  ): Promise<{ report: FactorAnalysisReport; usage: FactorAnalysisUsage }>;
}
