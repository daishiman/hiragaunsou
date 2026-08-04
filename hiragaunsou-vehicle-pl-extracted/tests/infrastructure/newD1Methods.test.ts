import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../src/infrastructure/db/schema";
import { D1RateMasterRepository, RATE_KEYS } from "../../src/infrastructure/db/D1MasterRepository";
import { D1ImportBatchRepository } from "../../src/infrastructure/db/D1ImportBatchRepository";
import { D1UsageLogRepository } from "../../src/infrastructure/db/D1UsageLogRepository";

/**
 * D1(drizzle-orm/d1)は vitest の node 環境では動かせないため、
 * スキーマ互換の better-sqlite3 + drizzle-orm/better-sqlite3 で
 * 新規追加した Infrastructure メソッド(setRate/findLatestBatch/findSince)を検証する。
 * upsertMany 等 D1固有の `.batch()` を使うメソッドはこの手法では検証できない(既存実装・対象外)。
 */
function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE rate_master (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      year_month TEXT,
      value REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    );
    CREATE TABLE csv_import_batch (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      year_month TEXT NOT NULL,
      file_name TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      imported_by TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed'
    );
    CREATE TABLE usage_log (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      recorded_by TEXT,
      detail_json TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return drizzle(sqlite, { schema }) as any;
}

describe("D1RateMasterRepository.setRate", () => {
  let db: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    db = createTestDb();
  });

  it("新規キーはinsertされ、getRatesで読み出せる", async () => {
    const repo = new D1RateMasterRepository(db);
    await repo.setRate(RATE_KEYS.tankPricePerLiter, "2026-05", 130, "user-1");
    const rates = await repo.getRates("2026-05");
    expect(rates.tankPricePerLiter).toBe(130);
  });

  it("同一key+yearMonthへの再設定はinsertせずupdateする(重複行を作らない)", async () => {
    const repo = new D1RateMasterRepository(db);
    await repo.setRate(RATE_KEYS.tankPricePerLiter, "2026-05", 130, "user-1");
    await repo.setRate(RATE_KEYS.tankPricePerLiter, "2026-05", 140, "user-2");

    const rows = db.select().from(schema.rateMaster).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(140);
  });

  it("yearMonth=nullは全期間共通値として保存する", async () => {
    const repo = new D1RateMasterRepository(db);
    await repo.setRate(RATE_KEYS.adminFeeRate, null, 0.2, null);
    const rates = await repo.getRates("2026-05");
    expect(rates.adminFeeRate).toBe(0.2);
  });
});

describe("D1ImportBatchRepository.findLatestBatch", () => {
  let db: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    db = createTestDb();
  });

  it("バッチが無ければnullを返す", async () => {
    const repo = new D1ImportBatchRepository(db);
    expect(await repo.findLatestBatch("2026-05", "payroll")).toBeNull();
  });

  it("複数バッチがあれば最新(importedAtが最大)を返す", async () => {
    const repo = new D1ImportBatchRepository(db);
    await repo.createBatch({
      id: "old",
      sourceType: "payroll",
      yearMonth: "2026-05",
      fileName: "old.csv",
      importedBy: null,
      rowCount: 10,
    });
    await new Promise((r) => setTimeout(r, 5));
    await repo.createBatch({
      id: "new",
      sourceType: "payroll",
      yearMonth: "2026-05",
      fileName: "new.csv",
      importedBy: null,
      rowCount: 20,
    });

    const latest = await repo.findLatestBatch("2026-05", "payroll");
    expect(latest?.id).toBe("new");
    expect(latest?.rowCount).toBe(20);
  });
});

describe("D1UsageLogRepository.findSince", () => {
  let db: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    db = createTestDb();
  });

  it("指定時刻以降のログのみ、新しい順で返す", async () => {
    const repo = new D1UsageLogRepository(db);
    await repo.record({
      kind: "factor_analysis_report",
      model: "claude-haiku-4-5",
      inputTokens: 100,
      outputTokens: 50,
      recordedBy: "u1",
      detail: { a: 1 },
    });
    const rows = await repo.findSince(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toEqual({ a: 1 });
  });
});
