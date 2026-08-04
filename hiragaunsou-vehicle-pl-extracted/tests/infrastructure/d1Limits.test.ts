import { describe, expect, it } from "vitest";
import { chunkForD1, D1_MAX_BOUND_PARAMS } from "../../src/infrastructure/db/d1Limits";

/**
 * D1は1クエリ100バインドパラメータまで。ローカルのminiflareは素のSQLite(上限999)で
 * この制限を再現しないため、ここを落とさないと本番の取込だけが失敗する。
 * 実際に「109行 × 8列 = 872パラメータ」を1文で送って収支表Excelの取込が全滅した。
 */
describe("chunkForD1", () => {
  it("1文あたりのパラメータ数がD1の上限を超えない", () => {
    const rows = Array.from({ length: 109 }, (_, i) => i);
    for (const columns of [1, 8, 9, 33, 55, 100]) {
      const chunks = chunkForD1(rows, columns);
      for (const chunk of chunks) {
        expect(chunk.length * columns).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
      }
      expect(chunks.flat()).toEqual(rows);
    }
  });

  it("raw_ingestion(8列)の109行は12行ずつ10回に分割される", () => {
    const chunks = chunkForD1(Array.from({ length: 109 }, (_, i) => i), 8);
    expect(chunks).toHaveLength(10);
    expect(chunks[0]).toHaveLength(12);
    expect(chunks.at(-1)).toHaveLength(1);
  });

  it("空配列では何も生成しない", () => {
    expect(chunkForD1([], 8)).toEqual([]);
  });

  it("1行だけで上限を超える列数は、分割で解決できないため即座に失敗させる", () => {
    expect(() => chunkForD1([1], 107)).toThrow("D1の上限");
  });
});
