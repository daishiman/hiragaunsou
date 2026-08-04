import type { VehiclePlCalculated } from "../rules/vehiclePlCalculation";
import type { DeficitCategory } from "../rules/deficitClassification";
import type { DeficitFactorItem } from "../repositories/DeficitFactorAnalysisRepository";
import type { FactorAnalysisUsage } from "./FactorAnalysisAiPort";

/** AI分析対象の1台分。ルールベース分類(classifyDeficit)の結果をヒントとして併せて渡す */
export interface DeficitFactorAnalysisTarget {
  vehicle: VehiclePlCalculated;
  /** repair(突発修繕型) / price(単価・効率型) / idle(遊休・低稼働型) */
  ruleCategory: DeficitCategory;
}

export interface DeficitFactorAnalysisInput {
  yearMonth: string;
  targets: DeficitFactorAnalysisTarget[];
}

export interface DeficitFactorAnalysisResultItem {
  vehicleNo: string;
  summary: string;
  factors: DeficitFactorItem[];
}

/**
 * 赤字車両1台ごとの科目別要因を分析するAIポート(Domain層のインターフェース)。
 * レート制限・コストを抑えるため、対象月の赤字車両をまとめて1回のAI呼び出しに渡す。
 */
export interface DeficitFactorAnalysisAiPort {
  analyze(
    input: DeficitFactorAnalysisInput,
  ): Promise<{ results: DeficitFactorAnalysisResultItem[]; usage: FactorAnalysisUsage }>;
}
