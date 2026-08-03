import { describe, expect, it } from "vitest";
import { summarizeUsage, type UsagePricing } from "../../src/usecase/steps/summarizeUsage";
import type { UsageLogRecord } from "../../src/domain/repositories/UsageLogRepository";

const pricing: UsagePricing = { inputUsdPerMillion: 1, outputUsdPerMillion: 5, usdJpyRate: 150 };

function log(overrides: Partial<UsageLogRecord>): UsageLogRecord {
  return {
    id: "1",
    kind: "factor_analysis_report",
    model: "claude-haiku-4-5",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    recordedBy: "user-a",
    detail: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("summarizeUsage", () => {
  it("空配列なら全て0", () => {
    const res = summarizeUsage([], pricing);
    expect(res.totalCostUsd).toBe(0);
    expect(res.callCount).toBe(0);
    expect(res.byUser).toEqual([]);
  });

  it("input 100万+output 100万トークンで $1+$5=$6 になる", () => {
    const res = summarizeUsage([log({})], pricing);
    expect(res.totalCostUsd).toBeCloseTo(6);
    expect(res.totalCostJpy).toBeCloseTo(900);
  });

  it("利用者別に集計する", () => {
    const res = summarizeUsage(
      [
        log({ recordedBy: "a", inputTokens: 1_000_000, outputTokens: 0 }),
        log({ recordedBy: "b", inputTokens: 0, outputTokens: 1_000_000 }),
        log({ recordedBy: "a", inputTokens: 1_000_000, outputTokens: 0 }),
      ],
      pricing,
    );
    expect(res.byUser).toHaveLength(2);
    const a = res.byUser.find((u) => u.recordedBy === "a")!;
    expect(a.callCount).toBe(2);
    expect(a.costUsd).toBeCloseTo(2);
  });

  it("recordedByがnullの場合もクラッシュせず集計する", () => {
    const res = summarizeUsage([log({ recordedBy: null })], pricing);
    expect(res.byUser[0]!.recordedBy).toBeNull();
  });
});
