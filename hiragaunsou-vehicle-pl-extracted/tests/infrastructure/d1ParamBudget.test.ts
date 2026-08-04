import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { rawIngestion, reviewFlag, vehiclePl } from "../../src/infrastructure/db/schema";
import { D1_MAX_BOUND_PARAMS } from "../../src/infrastructure/db/d1Limits";
import { RAW_INGESTION_COLUMNS } from "../../src/infrastructure/db/D1ImportBatchRepository";
import { REVIEW_FLAG_COLUMNS } from "../../src/infrastructure/db/D1ReviewFlagRepository";

/**
 * D1の「1クエリ100バインドパラメータ」制限に対する構造的な歯止め。
 *
 * ローカル(miniflare)は素のSQLite(上限999)でこの制限を再現しないため、
 * 列を1つ足した程度では開発中もテストも緑のまま通り、本番の取込だけが落ちる。
 * 実際にこれで収支表Excelの取込が全滅した。列数に依存する前提をここで固定する。
 */
describe("D1のバインドパラメータ予算", () => {
  function columnCount(table: Parameters<typeof getTableColumns>[0]): number {
    return Object.keys(getTableColumns(table)).length;
  }

  it("RAW_INGESTION_COLUMNS が raw_ingestion の実際の列数と一致する", () => {
    // saveRawIngestion は全列を明示指定する。列を追加したらこの定数も直す必要がある。
    // 直し忘れると分割サイズを過大に見積もり、1文が100パラメータを超えて本番だけ落ちる。
    expect(RAW_INGESTION_COLUMNS).toBe(columnCount(rawIngestion));
  });

  it("REVIEW_FLAG_COLUMNS が review_flag の列数を超えない", () => {
    // createFlags は既定値を持つ列を省くため、列数と完全一致はしない。
    expect(REVIEW_FLAG_COLUMNS).toBeLessThanOrEqual(columnCount(reviewFlag));
  });

  it("vehicle_pl は1行の upsert が単独で上限を超えない", () => {
    // upsertMany は1行=1文で送るため分割で救えない。列数がそのまま上限になる。
    // 更新値は excluded."列名" を使うのでパラメータを消費せず、挿入分の列数だけを見ればよい。
    expect(columnCount(vehiclePl)).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
  });
});
