import { describe, expect, it, vi, afterEach } from "vitest";
import { ClaudeDeficitFactorAnalysisClient } from "../../../src/infrastructure/ai/ClaudeDeficitFactorAnalysisClient";
import { DEFAULT_FACTOR_ANALYSIS_MODEL } from "../../../src/infrastructure/ai/ClaudeFactorAnalysisClient";
import { plRow } from "../../fixtures/vehiclePlRow";
import type { DeficitFactorAnalysisInput } from "../../../src/domain/services/DeficitFactorAnalysisAiPort";

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseInput: DeficitFactorAnalysisInput = {
  yearMonth: "2026-05",
  targets: [
    {
      vehicle: plRow({ no: "24", sales: 80000, profit: -20000, repairTotal: 50000 }),
      ruleCategory: "repair",
    },
    {
      vehicle: plRow({ no: "300", sales: 60000, profit: -10000 }),
      ruleCategory: "idle",
    },
  ],
};

function mockFetchOnce(response: Response) {
  const fn = vi.fn(async () => response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("ClaudeDeficitFactorAnalysisClient", () => {
  describe("analyze", () => {
    it("赤字車両群を1回のリクエストにまとめ、tool_choiceを強制する", async () => {
      const fetchMock = mockFetchOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                input: {
                  results: [
                    { vehicleNo: "24", summary: "修繕費が突出", factors: [] },
                    { vehicleNo: "300", summary: "稼働率が低い", factors: [] },
                  ],
                },
              },
            ],
            usage: { input_tokens: 300, output_tokens: 150 },
          }),
          { status: 200 },
        ),
      );

      const client = new ClaudeDeficitFactorAnalysisClient({ apiKey: "sk-test" });
      const result = await client.analyze(baseInput);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe(DEFAULT_FACTOR_ANALYSIS_MODEL);
      expect(body.tool_choice).toEqual({ type: "tool", name: "emit_deficit_factor_analysis" });
      expect(body.max_tokens).toBe(4000);
      // ルールカテゴリの日本語ラベルに変換されてプロンプトに入る
      expect(body.messages[0].content).toContain("突発修繕型(ルール判定)");
      expect(body.messages[0].content).toContain("遊休・低稼働型(ルール判定)");
      expect(body.messages[0].content).toContain("2026-05");

      expect(result.results).toHaveLength(2);
      expect(result.results[0]?.vehicleNo).toBe("24");
      expect(result.usage).toEqual({
        model: DEFAULT_FACTOR_ANALYSIS_MODEL,
        inputTokens: 300,
        outputTokens: 150,
      });
    });

    it("未知のruleCategoryはラベル変換されず、そのままプロンプトに載る(フォールバック)", async () => {
      const fetchMock = mockFetchOnce(
        new Response(
          JSON.stringify({
            content: [{ type: "tool_use", input: { results: [] } }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      );
      const client = new ClaudeDeficitFactorAnalysisClient({ apiKey: "sk-test" });
      await client.analyze({
        yearMonth: "2026-05",
        // @ts-expect-error 意図的に未知のカテゴリでフォールバック(RULE_CATEGORY_LABELS未定義)を検証する
        targets: [{ vehicle: plRow({ no: "1" }), ruleCategory: "unknown_category" }],
      });
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.messages[0].content).toContain("unknown_category");
    });

    it("targetsが空でも0台平均をNaNにせず0で計算してリクエストする(0除算対策)", async () => {
      const fetchMock = mockFetchOnce(
        new Response(
          JSON.stringify({
            content: [{ type: "tool_use", input: { results: [] } }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      );
      const client = new ClaudeDeficitFactorAnalysisClient({ apiKey: "sk-test" });
      const result = await client.analyze({ yearMonth: "2026-05", targets: [] });
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.messages[0].content).not.toContain("NaN");
      expect(result.results).toEqual([]);
    });

    it("modelオプションを指定するとリクエストと戻り値のusageに反映される", async () => {
      const fetchMock = mockFetchOnce(
        new Response(
          JSON.stringify({
            content: [{ type: "tool_use", input: { results: [] } }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      );
      const client = new ClaudeDeficitFactorAnalysisClient({ apiKey: "sk-test", model: "claude-opus-4" });
      const result = await client.analyze(baseInput);
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.model).toBe("claude-opus-4");
      expect(result.usage.model).toBe("claude-opus-4");
    });

    it("HTTPエラー応答は本文を含めた例外を投げる", async () => {
      mockFetchOnce(new Response("internal error", { status: 500 }));
      const client = new ClaudeDeficitFactorAnalysisClient({ apiKey: "sk-test" });
      await expect(client.analyze(baseInput)).rejects.toThrow(
        /Claude API呼び出しに失敗しました \(status=500\): internal error/,
      );
    });

    it("tool_useブロックが応答に含まれない場合は例外を投げる", async () => {
      mockFetchOnce(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "テキスト応答" }], usage: { input_tokens: 1, output_tokens: 1 } }),
          { status: 200 },
        ),
      );
      const client = new ClaudeDeficitFactorAnalysisClient({ apiKey: "sk-test" });
      await expect(client.analyze(baseInput)).rejects.toThrow(
        "Claude APIの応答にtool_useブロックが含まれていません",
      );
    });

    it("tool_useブロックはあるがinputが欠落している場合も例外を投げる(境界値)", async () => {
      mockFetchOnce(
        new Response(
          JSON.stringify({ content: [{ type: "tool_use" }], usage: { input_tokens: 1, output_tokens: 1 } }),
          { status: 200 },
        ),
      );
      const client = new ClaudeDeficitFactorAnalysisClient({ apiKey: "sk-test" });
      await expect(client.analyze(baseInput)).rejects.toThrow(
        "Claude APIの応答にtool_useブロックが含まれていません",
      );
    });
  });
});
