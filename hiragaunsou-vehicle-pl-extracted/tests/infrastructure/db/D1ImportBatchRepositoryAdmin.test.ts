import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";

/**
 * /admin/import-batches 画面向けに追加した管理専用メソッド(listAll / findById)の検証。
 * deleteBatches等の.batch()依存部分は既存のD1ImportBatchRepository.test.tsを参照。
 */
describe("D1ImportBatchRepository (admin extensions)", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  describe("listAll", () => {
    it("全期間・全帳票種別のバッチをimportedAt降順で返す", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      await repo.createBatch({
        id: "b1",
        sourceType: "payroll",
        yearMonth: "2026-05",
        fileName: "old.csv",
        importedBy: null,
        rowCount: 10,
      });
      await new Promise((r) => setTimeout(r, 5));
      await repo.createBatch({
        id: "b2",
        sourceType: "sales_monitor",
        yearMonth: "2026-08",
        fileName: "new.csv",
        importedBy: null,
        rowCount: 20,
      });
      const rows = await repo.listAll();
      expect(rows.map((r) => r.id)).toEqual(["b2", "b1"]);
      expect(rows[0]?.sourceType).toBe("sales_monitor");
      expect(rows[0]?.yearMonth).toBe("2026-08");
    });

    it("該当なしは空配列", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      expect(await repo.listAll()).toEqual([]);
    });
  });

  describe("findById", () => {
    it("存在するバッチを返す", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      await repo.createBatch({
        id: "b1",
        sourceType: "payroll",
        yearMonth: "2026-05",
        fileName: "a.csv",
        importedBy: null,
        rowCount: 10,
      });
      const found = await repo.findById("b1");
      expect(found).toEqual({
        id: "b1",
        sourceType: "payroll",
        yearMonth: "2026-05",
        fileName: "a.csv",
        rowCount: 10,
      });
    });

    it("存在しないIDはnull", async () => {
      const repo = new D1ImportBatchRepository(ctx.db);
      expect(await repo.findById("missing")).toBeNull();
    });
  });
});
