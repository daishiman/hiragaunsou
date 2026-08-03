import type {
  FactorAnalysisAiPort,
  FactorAnalysisReport,
  FactorAnalysisReportInput,
  FactorAnalysisUsage,
  MonthlyFleetSummary,
} from "../../domain/services/FactorAnalysisAiPort";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";

/** コスト重視の既定モデル。精度不足が実測で確認された場合のみ env var で昇格させる。 */
export const DEFAULT_FACTOR_ANALYSIS_MODEL = "claude-haiku-4-5";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const REPORT_TOOL_NAME = "emit_factor_analysis_report";

const REPORT_TOOL_SCHEMA = {
  name: REPORT_TOOL_NAME,
  description: "車両別収支表の月次データから抽出した損益変動要因レポートを構造化して返す",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "全体の損益変動を1〜3文で要約" },
      keyDrivers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            factor: { type: "string" },
            impact: { type: "string", enum: ["positive", "negative"] },
            amountYen: { type: "number" },
            explanation: { type: "string" },
          },
          required: ["factor", "impact", "amountYen", "explanation"],
        },
      },
      recommendations: { type: "array", items: { type: "string" } },
      lowConfidenceNotes: {
        type: "array",
        items: { type: "string" },
        description: "データ不足・異常値等でAIが断定できなかった論点。推測で埋めず正直に列挙する",
      },
    },
    required: ["summary", "keyDrivers", "recommendations", "lowConfidenceNotes"],
  },
} as const;

interface FleetMonthTotals {
  yearMonth: string;
  vehicleCount: number;
  sales: number;
  expense: number;
  profit: number;
  fuelTotal: number;
  repairTotal: number;
  laborTotal: number;
  tollNet: number;
  adminFee: number;
}

function sum(vehicles: VehiclePlCalculated[], pick: (v: VehiclePlCalculated) => number): number {
  return vehicles.reduce((acc, v) => acc + pick(v), 0);
}

function summarizeMonth(month: MonthlyFleetSummary): FleetMonthTotals {
  const { vehicles } = month;
  return {
    yearMonth: month.yearMonth,
    vehicleCount: vehicles.length,
    sales: sum(vehicles, (v) => v.sales),
    expense: sum(vehicles, (v) => v.expense),
    profit: sum(vehicles, (v) => v.profit),
    fuelTotal: sum(vehicles, (v) => v.fuelTotal),
    repairTotal: sum(vehicles, (v) => v.repairTotal),
    laborTotal: sum(vehicles, (v) => v.laborTotal),
    tollNet: sum(vehicles, (v) => v.tollNet),
    adminFee: sum(vehicles, (v) => v.adminFee),
  };
}

/** 直近月における損益変動が大きい車両上位N件(入力トークンを抑えるための絞り込み) */
function topProfitMovers(months: MonthlyFleetSummary[], limit: number): {
  vehicleNo: string;
  firstMonthProfit: number;
  lastMonthProfit: number;
  delta: number;
}[] {
  if (months.length < 2) return [];
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const firstByVehicle = new Map(first.vehicles.map((v) => [v.no, v.profit]));

  return last.vehicles
    .map((v) => {
      const firstMonthProfit = firstByVehicle.get(v.no) ?? 0;
      return { vehicleNo: v.no, firstMonthProfit, lastMonthProfit: v.profit, delta: v.profit - firstMonthProfit };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

function buildPrompt(input: FactorAnalysisReportInput): string {
  const fleetTotals = input.months.map(summarizeMonth);
  const movers = topProfitMovers(input.months, 10);

  return [
    `対象月: ${input.targetYearMonth}`,
    "以下は車両別収支表(vehicle_pl)を車両単位で集計した月次フリート合計値(円)。",
    JSON.stringify(fleetTotals),
    "損益変動が大きい車両トップ10(古い月→対象月の利益差分):",
    JSON.stringify(movers),
    "上記データだけを根拠に、対象月の損益がなぜその水準になったかを日本語で分析してください。",
    "データから読み取れない推測は書かず、根拠が弱い論点は lowConfidenceNotes に列挙してください。",
  ].join("\n\n");
}

export interface ClaudeFactorAnalysisClientOptions {
  apiKey: string;
  model?: string;
}

/**
 * Claude API(Messages API)を用いたFactorAnalysisAiPortの実装。
 * tool_choiceでツール呼び出しを強制し、自由テキストではなく構造化JSONを取得する
 * (llm-api-integrationスキルの「Structured Outputs必須」規律のAnthropic版)。
 */
export class ClaudeFactorAnalysisClient implements FactorAnalysisAiPort {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: ClaudeFactorAnalysisClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_FACTOR_ANALYSIS_MODEL;
  }

  async generateReport(
    input: FactorAnalysisReportInput,
  ): Promise<{ report: FactorAnalysisReport; usage: FactorAnalysisUsage }> {
    const prompt = buildPrompt(input);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2000,
        tools: [REPORT_TOOL_SCHEMA],
        tool_choice: { type: "tool", name: REPORT_TOOL_NAME },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Claude API呼び出しに失敗しました (status=${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      content: { type: string; input?: unknown }[];
      usage: { input_tokens: number; output_tokens: number };
    };

    const toolUse = data.content.find((block) => block.type === "tool_use");
    if (!toolUse || !toolUse.input) {
      throw new Error("Claude APIの応答にtool_useブロックが含まれていません");
    }

    return {
      report: toolUse.input as FactorAnalysisReport,
      usage: {
        model: this.model,
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  }
}
