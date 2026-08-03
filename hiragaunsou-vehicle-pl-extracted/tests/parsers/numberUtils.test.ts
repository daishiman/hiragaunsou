import { describe, expect, it } from "vitest";
import { parseJapaneseAmount, normalizeKey } from "../../src/infrastructure/parsers/numberUtils";

describe("parseJapaneseAmount", () => {
  it("カンマ区切りの金額文字列を数値へ変換する", () => {
    expect(parseJapaneseAmount("663,820")).toBe(663820);
    expect(parseJapaneseAmount("           663,820")).toBe(663820);
  });

  it("0埋め・空文字・null・undefinedは0を返す", () => {
    expect(parseJapaneseAmount("0")).toBe(0);
    expect(parseJapaneseAmount("")).toBe(0);
    expect(parseJapaneseAmount("   ")).toBe(0);
    expect(parseJapaneseAmount(null)).toBe(0);
    expect(parseJapaneseAmount(undefined)).toBe(0);
  });

  it("マイナス値も扱える", () => {
    expect(parseJapaneseAmount("-1,200")).toBe(-1200);
  });

  it("円記号混在も許容する", () => {
    expect(parseJapaneseAmount("¥1,000")).toBe(1000);
  });
});

describe("normalizeKey", () => {
  it("先頭ゼロを除去する", () => {
    expect(normalizeKey("00001111")).toBe("1111");
    expect(normalizeKey("0093")).toBe("93");
  });

  it("全角スペースを除去する", () => {
    expect(normalizeKey("88888　")).toBe("88888");
  });

  it("0そのものは0のまま", () => {
    expect(normalizeKey("0")).toBe("0");
  });
});
