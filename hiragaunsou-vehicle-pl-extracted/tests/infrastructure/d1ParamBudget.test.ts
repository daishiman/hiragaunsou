import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { improvementAudit, rawIngestion, reviewFlag, vehiclePl } from "../../src/infrastructure/db/schema";
import { chunkForD1, chunkIdsForD1, D1_MAX_BOUND_PARAMS } from "../../src/infrastructure/db/d1Limits";
import { RAW_INGESTION_COLUMNS } from "../../src/infrastructure/db/D1ImportBatchRepository";
import { REVIEW_FLAG_COLUMNS } from "../../src/infrastructure/db/D1ReviewFlagRepository";
import { AUDIT_COLUMNS } from "../../src/infrastructure/db/D1ImprovementRepository";
import {
  LIFECYCLE_BULK_MAX,
  PUBLISH_BULK_MAX,
} from "../../src/domain/rules/improvementLifecycle";
import { RETENTION_SWEEP_MAX } from "../../src/domain/rules/improvementRetention";

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

  it("AUDIT_COLUMNS が improvement_audit の実際の列数と一致する", () => {
    // 一括の発行・状態変更は選ばれた件数ぶんの監査ログを1度に入れる。
    // 分割サイズをこの定数から出しているので、列を足したらここも直す。
    expect(AUDIT_COLUMNS).toBe(columnCount(improvementAudit));
  });

  it("監査ログを上限件数まとめて入れても、1文が100パラメータを超えない", () => {
    // 発行25件・状態変更50件が一括の上限。50件を1文で入れると450個になり本番だけ落ちる。
    for (const n of [PUBLISH_BULK_MAX, LIFECYCLE_BULK_MAX]) {
      const rows = Array.from({ length: n }, (_, i) => i);
      for (const chunk of chunkForD1(rows, AUDIT_COLUMNS)) {
        expect(chunk.length * AUDIT_COLUMNS).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
      }
    }
  });

  it("保存期間の掃除は、拾いうる最大件数を分けてから消す", () => {
    // 写しと診断情報を別々に上限件数ずつ拾うので、id は最大で2倍まで増える。
    const ids = Array.from({ length: RETENTION_SWEEP_MAX * 2 }, (_, i) => `improve_${i}`);
    for (const chunk of chunkIdsForD1(ids)) {
      expect(chunk.length).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    }
  });

  it("vehicle_pl は1行の upsert が単独で上限を超えない", () => {
    // upsertMany は1行=1文で送るため分割で救えない。列数がそのまま上限になる。
    // 更新値は excluded."列名" を使うのでパラメータを消費せず、挿入分の列数だけを見ればよい。
    expect(columnCount(vehiclePl)).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
  });
});
