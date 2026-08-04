import { afterEach, describe, expect, it } from "vitest";
import { AI_PROVIDERS } from "../../src/domain/repositories/AiProviderCredentialRepository";
import {
  MODEL_CATALOG,
  defaultModelId,
  findModelOption,
} from "../../src/domain/rules/aiModelCatalog";

describe("MODEL_CATALOG", () => {
  it("全プロバイダが上/中/下の3ランクをちょうど1件ずつ持つ", () => {
    for (const provider of AI_PROVIDERS) {
      const options = MODEL_CATALOG[provider];
      expect(options).toHaveLength(3);
      expect(options.map((o) => o.rank).sort()).toEqual(["light", "standard", "top"]);
    }
  });

  it("モデルIDに重複が無い (同じプロバイダ内で選択が曖昧にならない)", () => {
    for (const provider of AI_PROVIDERS) {
      const ids = MODEL_CATALOG[provider].map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("findModelOption", () => {
  it("プロバイダとIDが一致するモデルを返す", () => {
    const opt = findModelOption("anthropic", "claude-sonnet-5");
    expect(opt?.rank).toBe("standard");
  });

  it("存在しないIDはnullを返す", () => {
    expect(findModelOption("anthropic", "does-not-exist")).toBeNull();
  });
});

describe("defaultModelId", () => {
  it("標準ランクのモデルIDを既定にする", () => {
    for (const provider of AI_PROVIDERS) {
      const id = defaultModelId(provider);
      const opt = MODEL_CATALOG[provider].find((o) => o.id === id);
      expect(opt?.rank).toBe("standard");
    }
  });

  // 以下2件はプロバイダのモデル改廃(標準ランクの欠落・選択肢の消滅)という異常事態への
  // フォールバックを検証する。カタログは将来モデル改廃のたびに書き換わる想定 (aiModelCatalog.ts の
  // コメント参照) であり、標準ランクを一時的に切らしても既定モデル解決自体は落ちないことを保証したい。
  describe("標準ランクが欠けている場合のフォールバック", () => {
    const original = MODEL_CATALOG.anthropic;

    afterEach(() => {
      MODEL_CATALOG.anthropic = original;
    });

    it("標準ランクの選択肢が無ければ先頭の選択肢を既定にする", () => {
      MODEL_CATALOG.anthropic = original.filter((o) => o.rank !== "standard");
      expect(defaultModelId("anthropic")).toBe(original[0]?.id);
    });

    it("選択肢が1件も無ければnullを返す", () => {
      MODEL_CATALOG.anthropic = [];
      expect(defaultModelId("anthropic")).toBeNull();
    });
  });
});
