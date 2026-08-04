import type { UsageLogRecord } from "../../domain/repositories/UsageLogRepository";

/**
 * /usage 画面用: AI(Claude API)利用ログから概算費用を集計する。
 *
 * 「請求の正はAnthropicのコンソール」であることを前提に、あくまで概算として
 * 利用者別内訳・合計費用を出す。単価はハードコードせず引数(env var由来)で受け取る。
 */
export interface UsagePricing {
  /** input 100万トークンあたりのUSD単価 */
  inputUsdPerMillion: number;
  /** output 100万トークンあたりのUSD単価 */
  outputUsdPerMillion: number;
  /** 円換算レート (USD→JPY) */
  usdJpyRate: number;
}

export const DEFAULT_USAGE_PRICING: UsagePricing = {
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 5,
  usdJpyRate: 150,
};

export interface UsageByUser {
  recordedBy: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costJpy: number;
  callCount: number;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalCostJpy: number;
  callCount: number;
  byUser: UsageByUser[];
  recent: UsageLogRecord[];
}

function costUsd(inputTokens: number, outputTokens: number, pricing: UsagePricing): number {
  return (
    (inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (outputTokens / 1_000_000) * pricing.outputUsdPerMillion
  );
}

export function summarizeUsage(
  logs: UsageLogRecord[],
  pricing: UsagePricing = DEFAULT_USAGE_PRICING,
  recentLimit = 20,
): UsageSummary {
  const byUserMap = new Map<string, UsageByUser>();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const log of logs) {
    totalInputTokens += log.inputTokens;
    totalOutputTokens += log.outputTokens;

    const key = log.recordedBy ?? "__unknown__";
    const entry = byUserMap.get(key) ?? {
      recordedBy: log.recordedBy,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costJpy: 0,
      callCount: 0,
    };
    entry.inputTokens += log.inputTokens;
    entry.outputTokens += log.outputTokens;
    entry.callCount += 1;
    byUserMap.set(key, entry);
  }

  const byUser = Array.from(byUserMap.values())
    .map((entry) => {
      const usd = costUsd(entry.inputTokens, entry.outputTokens, pricing);
      return { ...entry, costUsd: usd, costJpy: usd * pricing.usdJpyRate };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  const totalCostUsd = costUsd(totalInputTokens, totalOutputTokens, pricing);

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    totalCostJpy: totalCostUsd * pricing.usdJpyRate,
    callCount: logs.length,
    byUser,
    recent: logs.slice(0, recentLimit),
  };
}
