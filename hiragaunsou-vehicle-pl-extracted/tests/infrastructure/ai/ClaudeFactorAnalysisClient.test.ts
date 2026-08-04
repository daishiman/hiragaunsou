import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ClaudeFactorAnalysisClient,
  DEFAULT_FACTOR_ANALYSIS_MODEL,
} from "../../../src/infrastructure/ai/ClaudeFactorAnalysisClient";
import { plRow } from "../../fixtures/vehiclePlRow";
import type { FactorAnalysisReportInput } from "../../../src/domain/services/FactorAnalysisAiPort";

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseInput: FactorAnalysisReportInput = {
  targetYearMonth: "2026-05",
  months: [
    { yearMonth: "2026-04", vehicles: [plRow({ no: "24", sales: 100000, profit: 10000 })] },
    { yearMonth: "2026-05", vehicles: [plRow({ no: "24", sales: 90000, profit: 5000 })] },
  ],
};

function mockFetchOnce(response: Response) {
  const fn = vi.fn(async () => response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("ClaudeFactorAnalysisClient", () => {
  describe("generateReport", () => {
    it("Anthropic Messages APIへtool_choiceを強制したリクエストを送る", async () => {
      const fetchMock = mockFetchOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                input: {
                  summary: "5月は燃料費上昇により減益",
                  keyDrivers: [],
                  recommendations: [],
                  lowConfidenceNotes: [],
                },
              },
            ],
            usage: { input_tokens: 500, output_tokens: 200 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const client = new ClaudeFactorAnalysisClient({ apiKey: "sk-test" });
      const result = await client.generateReport(baseInput);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        "content-type": "application/json",
        "x-api-key": "sk-test",
        "anthropic-version": "2023-06-01",
      });
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe(DEFAULT_FACTOR_ANALYSIS_MODEL);
      expect(body.tool_choice).toEqual({ type: "tool", name: "emit_factor_analysis_report" });
      expect(body.tools[0].name).toBe("emit_factor_analysis_report");
      // プロンプトに対象月と月次フリート集計値が含まれる
      expect(body.messages[0].content).toContain("2026-05");
      expect(body.messages[0].content).toContain("100000");

      expect(result.report.summary).toBe("5月は燃料費上昇により減益");
      expect(result.usage).toEqual({
        model: DEFAULT_FACTOR_ANALYSIS_MODEL,
        inputTokens: 500,
        outputTokens: 200,
      });
    });

    it("modelオプションを指定するとリクエストに反映され、既定値を上書きする", async () => {
      const fetchMock = mockFetchOnce(
        new Response(
          JSON.stringify({
            content: [{ type: "tool_use", input: { summary: "s", keyDrivers: [], recommendations: [], lowConfidenceNotes: [] } }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      );
      const client = new ClaudeFactorAnalysisClient({ apiKey: "sk-test", model: "claude-opus-4" });
      const result = await client.generateReport(baseInput);
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.model).toBe("claude-opus-4");
      expect(result.usage.model).toBe("claude-opus-4");
    });

    it("直近2ヶ月の損益差分が大きい車両トップNをプロンプトに含める(1ヶ月分だけの場合は絞り込みなし)", async () => {
      const fetchMock = mockFetchOnce(
        new Response(
          JSON.stringify({
            content: [{ type: "tool_use", input: { summary: "s", keyDrivers: [], recommendations: [], lowConfidenceNotes: [] } }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      );
      const client = new ClaudeFactorAnalysisClient({ apiKey: "sk-test" });
      await client.generateReport({ targetYearMonth: "2026-05", months: [{ yearMonth: "2026-05", vehicles: [plRow({ no: "1" })] }] });
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      // topProfitMoversはmonths.length<2で[]を返す実装 → プロンプトに空配列が入る
      expect(body.messages[0].content).toContain("損益変動が大きい車両トップ10");
      expect(body.messages[0].content).toMatch(/\[\]/);
    });

    it("HTTPエラー応答は本文を含めた例外を投げる", async () => {
      mockFetchOnce(new Response("rate limited", { status: 429 }));
      const client = new ClaudeFactorAnalysisClient({ apiKey: "sk-test" });
      await expect(client.generateReport(baseInput)).rejects.toThrow(
        /Claude API呼び出しに失敗しました \(status=429\): rate limited/,
      );
    });

    it("tool_useブロックが応答に含まれない場合は例外を投げる", async () => {
      mockFetchOnce(
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "自由記述で答えました" }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      );
      const client = new ClaudeFactorAnalysisClient({ apiKey: "sk-test" });
      await expect(client.generateReport(baseInput)).rejects.toThrow(
        "Claude APIの応答にtool_useブロックが含まれていません",
      );
    });

    it("tool_useブロックはあるがinputが欠落している場合も例外を投げる(境界値)", async () => {
      mockFetchOnce(
        new Response(
          JSON.stringify({
            content: [{ type: "tool_use" }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      );
      const client = new ClaudeFactorAnalysisClient({ apiKey: "sk-test" });
      await expect(client.generateReport(baseInput)).rejects.toThrow(
        "Claude APIの応答にtool_useブロックが含まれていません",
      );
    });
  });
});
