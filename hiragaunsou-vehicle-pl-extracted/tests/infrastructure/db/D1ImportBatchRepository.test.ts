import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";

/**
 * findLatestBatch は tests/infrastructure/newD1Methods.test.ts で既に検証済みのため、
 * ここでは createBatch / findBatches / findRawRows / countRawRowsWithFlags と、
 * saveRawIngestion・deleteBatches の batch() 依存部分の境界を検証する。
 */
describe("D1ImportBatchRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  describe("createBatch", () => {
    it("excludedRowCountを省略すると0で保存される", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      await repo.createBatch({
        id: "b1",
        sourceType: "payroll",
        yearMonth: "2026-05",
        fileName: "a.csv",
        importedBy: null,
        rowCount: 10,
      });
      const row = ctx.sqlite.prepare("SELECT excluded_row_count FROM csv_import_batch WHERE id = ?").get(
        "b1",
      ) as { excluded_row_count: number };
      expect(row.excluded_row_count).toBe(0);
    });

    it("excludedRowCountを指定するとその値で保存される", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      await repo.createBatch({
        id: "b2",
        sourceType: "vehicle_operation",
        yearMonth: "2026-05",
        fileName: "b.csv",
        importedBy: null,
        rowCount: 100,
        excludedRowCount: 5,
      });
      const row = ctx.sqlite.prepare("SELECT excluded_row_count FROM csv_import_batch WHERE id = ?").get(
        "b2",
      ) as { excluded_row_count: number };
      expect(row.excluded_row_count).toBe(5);
    });
  });

  describe("findBatches", () => {
    it("該当年月・帳票種別のバッチをimportedAt降順で返す", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
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
      const rows = await repo.findBatches("2026-05", "payroll");
      expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
    });

    it("該当なしは空配列", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      expect(await repo.findBatches("2026-05", "payroll")).toEqual([]);
    });
  });

  describe("findRawRows / countRawRowsWithFlags", () => {
    it("生データが無ければ空配列・0件を返す", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      expect(await repo.findRawRows("2026-05", "payroll")).toEqual([]);
      expect(await repo.countRawRowsWithFlags("2026-05", "payroll")).toBe(0);
    });

    it("flagsがnullの行はJSON配列ではなく空配列にフォールバックする", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      await repo.createBatch({
        id: "b1",
        sourceType: "payroll",
        yearMonth: "2026-05",
        fileName: "a.csv",
        importedBy: null,
        rowCount: 1,
      });
      ctx.sqlite
        .prepare(
          `INSERT INTO raw_ingestion (id, batch_id, source_type, year_month, row_index, natural_key, raw_json, flags)
           VALUES ('r1', 'b1', 'payroll', '2026-05', 0, 'K-1', '{"a":1}', NULL)`,
        )
        .run();
      ctx.sqlite
        .prepare(
          `INSERT INTO raw_ingestion (id, batch_id, source_type, year_month, row_index, natural_key, raw_json, flags)
           VALUES ('r2', 'b1', 'payroll', '2026-05', 1, 'K-2', '{"a":2}', '["duplicate_suspect"]')`,
        )
        .run();

      const rows = await repo.findRawRows("2026-05", "payroll");
      expect(rows).toHaveLength(2);
      const noFlag = rows.find((r) => r.naturalKey === "K-1");
      const withFlag = rows.find((r) => r.naturalKey === "K-2");
      expect(noFlag?.flags).toEqual([]);
      expect(withFlag?.flags).toEqual(["duplicate_suspect"]);
      expect(withFlag?.raw).toEqual({ a: 2 });

      expect(await repo.countRawRowsWithFlags("2026-05", "payroll")).toBe(1);
    });
  });

  describe("saveRawIngestion / deleteBatches (batch()依存)", () => {
    it("rows.length===0のときは何もせず正常終了する", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      await expect(repo.saveRawIngestion("b1", "payroll", "2026-05", [])).resolves.toBeUndefined();
    });

    it("1行以上ではD1固有の.batch()を呼ぶため、better-sqlite3ドライバでは例外になる", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      await expect(
        repo.saveRawIngestion("b1", "payroll", "2026-05", [
          { rowIndex: 0, naturalKey: "K-1", raw: { a: 1 }, flags: [] },
        ]),
      ).rejects.toThrow();
    });

    it("batchIdsが空配列のときは何もせず0を返す", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      expect(await repo.deleteBatches("2026-05", "payroll", [])).toBe(0);
    });

    it("batchIdsを指定するとD1固有の.batch()を呼ぶため、better-sqlite3ドライバでは例外になる", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      await repo.createBatch({
        id: "b1",
        sourceType: "payroll",
        yearMonth: "2026-05",
        fileName: "a.csv",
        importedBy: null,
        rowCount: 1,
      });
      await expect(repo.deleteBatches("2026-05", "payroll", ["b1"])).rejects.toThrow();
    });
  });

  describe("listYearMonths", () => {
    async function seed(repo: D1ImportBatchRepository, yearMonth: string, sourceType: string) {
      await repo.createBatch({
        id: `${yearMonth}-${sourceType}`,
        sourceType,
        yearMonth,
        fileName: "a.csv",
        importedBy: null,
        rowCount: 1,
      });
    }

    it("同じ月に複数帳票を取り込んでも月は1つだけ返す(新しい順)", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      await seed(repo, "2026-04", "payroll");
      await seed(repo, "2026-05", "vehicle_operation");
      await seed(repo, "2026-05", "sales_monitor");
      expect(await repo.listYearMonths()).toEqual(["2026-05", "2026-04"]);
    });

    it("limitで件数を絞れる", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      await seed(repo, "2026-03", "payroll");
      await seed(repo, "2026-04", "payroll");
      await seed(repo, "2026-05", "payroll");
      expect(await repo.listYearMonths(2)).toEqual(["2026-05", "2026-04"]);
    });

    it("取込が1件も無ければ空配列", async () => {
      expect(await new D1ImportBatchRepository(ctx.db).listYearMonths()).toEqual([]);
    });
  });
});
