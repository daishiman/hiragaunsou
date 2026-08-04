import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";

function insertFlag(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  row: {
    id: string;
    yearMonth: string;
    vehicleNo: string | null;
    field: string | null;
    type: string;
    severity: string;
    message: string;
    status: string;
  },
) {
  sqlite
    .prepare(
      `INSERT INTO review_flag (id, year_month, vehicle_no, field, type, severity, message, status)
       VALUES (@id, @yearMonth, @vehicleNo, @field, @type, @severity, @message, @status)`,
    )
    .run(row);
}

describe("D1ReviewFlagRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
    ctx.sqlite
      .prepare(`INSERT INTO user (id, name, email, updated_at) VALUES ('user-1', 'u', 'u@example.com', 0)`)
      .run();
  });

  describe("findOpenByYearMonth", () => {
    it("該当月のopen状態の行だけを返す(resolved/dismissedは除く)", async () => {
      insertFlag(ctx.sqlite, {
        id: "1",
        yearMonth: "2026-05",
        vehicleNo: "24",
        field: "fuelTotal",
        type: "anomaly_range",
        severity: "warning",
        message: "燃料費が例月比で逸脱",
        status: "open",
      });
      insertFlag(ctx.sqlite, {
        id: "2",
        yearMonth: "2026-05",
        vehicleNo: "300",
        field: null,
        type: "duplicate_suspect",
        severity: "info",
        message: "2重計上疑い",
        status: "dismissed",
      });
      insertFlag(ctx.sqlite, {
        id: "3",
        yearMonth: "2026-04",
        vehicleNo: "24",
        field: "fuelTotal",
        type: "anomaly_range",
        severity: "warning",
        message: "前月分",
        status: "open",
      });

      const repo = new D1ReviewFlagRepository(ctx.db);
      const rows = await repo.findOpenByYearMonth("2026-05");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "1", vehicleNo: "24", status: "open" });
    });

    it("該当が無ければ空配列を返す", async () => {
      const repo = new D1ReviewFlagRepository(ctx.db);
      expect(await repo.findOpenByYearMonth("2026-05")).toEqual([]);
    });
  });

  describe("resolve", () => {
    it("statusとresolvedBy/resolvedAt/resolutionNoteを設定する", async () => {
      insertFlag(ctx.sqlite, {
        id: "1",
        yearMonth: "2026-05",
        vehicleNo: "24",
        field: "fuelTotal",
        type: "anomaly_range",
        severity: "warning",
        message: "燃料費が例月比で逸脱",
        status: "open",
      });
      const repo = new D1ReviewFlagRepository(ctx.db);
      await repo.resolve("1", "user-1", "corrected", "単価入力ミスを修正");

      const row = ctx.sqlite.prepare("SELECT * FROM review_flag WHERE id = ?").get("1") as {
        status: string;
        resolved_by: string;
        resolved_at: number;
        resolution_note: string;
      };
      expect(row.status).toBe("corrected");
      expect(row.resolved_by).toBe("user-1");
      expect(row.resolution_note).toBe("単価入力ミスを修正");
      expect(row.resolved_at).toBeGreaterThan(0);
    });

    it("noteがnullでも正常に保存できる(境界値)", async () => {
      insertFlag(ctx.sqlite, {
        id: "1",
        yearMonth: "2026-05",
        vehicleNo: null,
        field: null,
        type: "misc_entry",
        severity: "info",
        message: "諸口",
        status: "open",
      });
      const repo = new D1ReviewFlagRepository(ctx.db);
      await repo.resolve("1", "user-1", "approved", null);
      const row = ctx.sqlite.prepare("SELECT resolution_note, status FROM review_flag WHERE id = ?").get(
        "1",
      ) as { resolution_note: string | null; status: string };
      expect(row.resolution_note).toBeNull();
      expect(row.status).toBe("approved");
    });

    it("存在しないidを指定しても例外にならない(0行更新)", async () => {
      const repo = new D1ReviewFlagRepository(ctx.db);
      await expect(repo.resolve("nope", "user-1", "dismissed", null)).resolves.toBeUndefined();
    });
  });

  describe("reopen", () => {
    it("resolve済みの行をopenへ戻し、解決系フィールドをクリアする", async () => {
      insertFlag(ctx.sqlite, {
        id: "1",
        yearMonth: "2026-05",
        vehicleNo: "24",
        field: "fuelTotal",
        type: "anomaly_range",
        severity: "warning",
        message: "燃料費が例月比で逸脱",
        status: "open",
      });
      const repo = new D1ReviewFlagRepository(ctx.db);
      await repo.resolve("1", "user-1", "corrected", "メモ");
      await repo.reopen("1");

      const row = ctx.sqlite.prepare("SELECT * FROM review_flag WHERE id = ?").get("1") as {
        status: string;
        resolved_by: string | null;
        resolved_at: number | null;
        resolution_note: string | null;
      };
      expect(row.status).toBe("open");
      expect(row.resolved_by).toBeNull();
      expect(row.resolved_at).toBeNull();
      expect(row.resolution_note).toBeNull();
    });
  });

  describe("createFlags", () => {
    it("flagsが空配列のときは何もせず正常終了する", async () => {
      const repo = new D1ReviewFlagRepository(ctx.db);
      await expect(repo.createFlags("2026-05", [])).resolves.toBeUndefined();
      expect(await repo.findOpenByYearMonth("2026-05")).toEqual([]);
    });

    it("1件以上ではD1固有の.batch()を呼ぶため、better-sqlite3ドライバでは例外になる", async () => {
      const repo = new D1ReviewFlagRepository(ctx.db);
      await expect(
        repo.createFlags("2026-05", [
          {
            vehicleNo: "24",
            field: "fuelTotal",
            type: "anomaly_range",
            severity: "warning",
            message: "燃料費が例月比で逸脱",
            monthlyReference: 50000,
          },
        ]),
      ).rejects.toThrow();
    });
  });
});
