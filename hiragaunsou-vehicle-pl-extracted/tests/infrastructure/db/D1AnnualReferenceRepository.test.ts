import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1AnnualReferenceRepository } from "../../../src/infrastructure/db/D1AnnualReferenceRepository";
import type { AnnualReferenceRecord } from "../../../src/domain/repositories/VehiclePlRepository";

function insertRef(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  row: { id: string; kind: string; yearMonth: string; sales: number; expense: number; note: string | null },
) {
  sqlite
    .prepare(
      `INSERT INTO annual_reference (id, kind, year_month, sales, expense, note)
       VALUES (@id, @kind, @yearMonth, @sales, @expense, @note)`,
    )
    .run(row);
}

describe("D1AnnualReferenceRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  describe("findByKind", () => {
    it("yearMonthsが空配列ならクエリを発行せず空配列を返す", async () => {
      const repo = new D1AnnualReferenceRepository(ctx.db);
      expect(await repo.findByKind("prev_year_actual", [])).toEqual([]);
    });

    it("指定kind・yearMonthsに一致する行だけを返す", async () => {
      insertRef(ctx.sqlite, {
        id: "1",
        kind: "prev_year_actual",
        yearMonth: "2025-05",
        sales: 1000,
        expense: 800,
        note: "去年",
      });
      insertRef(ctx.sqlite, {
        id: "2",
        kind: "excel_annual_sheet",
        yearMonth: "2025-05",
        sales: 999,
        expense: 799,
        note: "Excel",
      });
      insertRef(ctx.sqlite, {
        id: "3",
        kind: "prev_year_actual",
        yearMonth: "2025-06",
        sales: 1100,
        expense: 900,
        note: null,
      });

      const repo = new D1AnnualReferenceRepository(ctx.db);
      const rows = await repo.findByKind("prev_year_actual", ["2025-05"]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        kind: "prev_year_actual",
        yearMonth: "2025-05",
        sales: 1000,
        expense: 800,
        note: "去年",
      });
    });

    it("複数yearMonthsを指定すると該当する全月を返す", async () => {
      insertRef(ctx.sqlite, {
        id: "1",
        kind: "prev_year_actual",
        yearMonth: "2025-05",
        sales: 1000,
        expense: 800,
        note: null,
      });
      insertRef(ctx.sqlite, {
        id: "2",
        kind: "prev_year_actual",
        yearMonth: "2025-06",
        sales: 1100,
        expense: 900,
        note: null,
      });
      const repo = new D1AnnualReferenceRepository(ctx.db);
      const rows = await repo.findByKind("prev_year_actual", ["2025-05", "2025-06"]);
      expect(rows).toHaveLength(2);
    });
  });

  describe("upsertMany", () => {
    it("recordsが空配列のときは何もせず正常終了する", async () => {
      const repo = new D1AnnualReferenceRepository(ctx.db);
      await expect(repo.upsertMany([], null)).resolves.toBeUndefined();
    });

    it("1件以上ではD1固有の.batch()を呼ぶため、better-sqlite3ドライバでは例外になる", async () => {
      const repo = new D1AnnualReferenceRepository(ctx.db);
      const record: AnnualReferenceRecord = {
        kind: "prev_year_actual",
        yearMonth: "2025-05",
        sales: 1000,
        expense: 800,
        note: null,
      };
      await expect(repo.upsertMany([record], null)).rejects.toThrow();
    });
  });
});
