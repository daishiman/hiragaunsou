import type {
  DeficitFactorAnalysisAiPort,
  DeficitFactorAnalysisInput,
  DeficitFactorAnalysisResultItem,
} from "../../domain/services/DeficitFactorAnalysisAiPort";
import type { FactorAnalysisUsage } from "../../domain/services/FactorAnalysisAiPort";
import type { DeficitFactorCategory } from "../../domain/repositories/DeficitFactorAnalysisRepository";
import { DEFAULT_FACTOR_ANALYSIS_MODEL } from "./ClaudeFactorAnalysisClient";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const ANALYSIS_TOOL_NAME = "emit_deficit_factor_analysis";

/** vehicle_pl の科目キー(TODO(human)のbuildPromptが送るデータと対応させる) */
const FACTOR_CATEGORIES: readonly DeficitFactorCategory[] = [
  "sales",
  "tollNet",
  "fuelTotal",
  "repairTotal",
  "laborTotal",
  "insTotal",
  "taxTotal",
  "transportTotal",
  "adminTotal",
];

const ANALYSIS_TOOL_SCHEMA = {
  name: ANALYSIS_TOOL_NAME,
  description: "赤字車両ごとに、どの科目が要因で赤字になっているかを構造化して返す",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            vehicleNo: { type: "string" },
            summary: { type: "string", description: "この車両が赤字になっている理由を1文で要約" },
            factors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string", enum: FACTOR_CATEGORIES },
                  direction: {
                    type: "string",
                    enum: ["high", "low"],
                    description: "その科目が高すぎる(費用)か低すぎる(売上)か",
                  },
                  amountYen: { type: "number", description: "目安となる差分金額(円)" },
                  explanation: { type: "string" },
                },
                required: ["category", "direction", "amountYen", "explanation"],
              },
            },
          },
          required: ["vehicleNo", "summary", "factors"],
        },
      },
    },
    required: ["results"],
  },
} as const;

const RULE_CATEGORY_LABELS: Record<string, string> = {
  repair: "突発修繕型(ルール判定)",
  price: "単価・効率型(ルール判定)",
  idle: "遊休・低稼働型(ルール判定)",
};

function round0(value: number): number {
  return Math.round(value);
}

/**
 * 赤字車両の月次収支データからAIに送るプロンプトを組み立てる。
 * 「高い/低い」を判断するには比較対象が要るため、同月の赤字車両群の平均値を
 * 目安として併せて渡す(全社平均ではなく赤字車両同士の平均。突発値に引きずられにくい)。
 */
function buildPrompt(input: DeficitFactorAnalysisInput): string {
  const rows = input.targets.map((t) => ({
    vehicleNo: t.vehicle.no,
    ruleCategory: RULE_CATEGORY_LABELS[t.ruleCategory] ?? t.ruleCategory,
    sales: t.vehicle.sales,
    profit: t.vehicle.profit,
    km: t.vehicle.km,
    fuelTotal: t.vehicle.fuelTotal,
    repairTotal: t.vehicle.repairTotal,
    laborTotal: t.vehicle.laborTotal,
    tollNet: t.vehicle.tollNet,
    insTotal: t.vehicle.insTotal,
    taxTotal: t.vehicle.taxTotal,
    transportTotal: t.vehicle.transportTotal,
    adminTotal: t.vehicle.adminTotal,
  }));

  const averages = Object.fromEntries(
    FACTOR_CATEGORIES.map((key) => {
      const values = input.targets.map((t) => t.vehicle[key]);
      const avg = values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
      return [key, round0(avg)];
    }),
  );

  return [
    `対象年月: ${input.yearMonth}`,
    `以下は${input.yearMonth}に赤字だった車両${input.targets.length}台の科目別データ(円)。`,
    JSON.stringify(rows),
    "上記車両群における科目ごとの平均値(同月の赤字車両同士の平均。比較の目安):",
    JSON.stringify(averages),
    "各車両について、平均と比べてどの科目が高すぎる(費用)・低すぎる(売上)ために赤字になっているかを、上記データだけを根拠に分析してください。",
    "ruleCategoryは機械的なルール分類のヒントです。参考にしてよいですが、実際のデータから読み取れる根拠を優先してください。",
    "データから読み取れない推測はせず、根拠が弱い場合はexplanationにその旨を正直に書いてください。",
    "対象車両は必ず全台分をresultsに含め、vehicleNoは上記データのものと一致させてください。",
  ].join("\n\n");
}

export interface ClaudeDeficitFactorAnalysisClientOptions {
  apiKey: string;
  model?: string;
}

/**
 * Claude API(Messages API)を用いたDeficitFactorAnalysisAiPortの実装。
 * tool_choiceでツール呼び出しを強制し、赤字車両1台ごとの科目別要因を配列で取得する
 * (1回のAI呼び出しに複数台まとめる。レート制限・コスト対策)。
 */
export class ClaudeDeficitFactorAnalysisClient implements DeficitFactorAnalysisAiPort {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: ClaudeDeficitFactorAnalysisClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_FACTOR_ANALYSIS_MODEL;
  }

  async analyze(
    input: DeficitFactorAnalysisInput,
  ): Promise<{ results: DeficitFactorAnalysisResultItem[]; usage: FactorAnalysisUsage }> {
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
        max_tokens: 4000,
        tools: [ANALYSIS_TOOL_SCHEMA],
        tool_choice: { type: "tool", name: ANALYSIS_TOOL_NAME },
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

    const parsed = toolUse.input as { results: DeficitFactorAnalysisResultItem[] };

    return {
      results: parsed.results,
      usage: {
        model: this.model,
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  }
}
