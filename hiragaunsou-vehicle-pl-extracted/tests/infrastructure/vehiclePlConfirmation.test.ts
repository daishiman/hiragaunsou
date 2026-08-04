import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../src/infrastructure/db/schema";
import { D1VehiclePlRepository } from "../../src/infrastructure/db/D1VehiclePlRepository";

/**
 * STEP8 の確定状態を読む getConfirmation / setConfirmed を、
 * スキーマ互換の better-sqlite3 で検証する (D1 は vitest の node 環境で動かせないため)。
 * SQL の SUM() は文字列で返ることがあるので、件数として数えられているかまで見る。
 */
function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE vehicle_pl (
      id TEXT PRIMARY KEY,
      year_month TEXT NOT NULL,
      vehicle_no TEXT NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  const insert = sqlite.prepare(
    "INSERT INTO vehicle_pl (id, year_month, vehicle_no, confirmed) VALUES (?, ?, ?, ?)",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: drizzle(sqlite, { schema }) as any, insert };
}

describe("D1VehiclePlRepository の確定状態 (業務フロー STEP8)", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  it("行が無い月は total も confirmed も0", async () => {
    const repo = new D1VehiclePlRepository(ctx.db);
    expect(await repo.getConfirmation("2026-05")).toEqual({ total: 0, confirmed: 0 });
  });

  it("未確定の行だけなら confirmed は0", async () => {
    ctx.insert.run("2026-05::24", "2026-05", "24", 0);
    ctx.insert.run("2026-05::300", "2026-05", "300", 0);
    const repo = new D1VehiclePlRepository(ctx.db);
    expect(await repo.getConfirmation("2026-05")).toEqual({ total: 2, confirmed: 0 });
  });

  it("setConfirmed でその月の全行が確定済みになる", async () => {
    ctx.insert.run("2026-05::24", "2026-05", "24", 0);
    ctx.insert.run("2026-05::300", "2026-05", "300", 0);
    const repo = new D1VehiclePlRepository(ctx.db);
    await repo.setConfirmed("2026-05", true);
    expect(await repo.getConfirmation("2026-05")).toEqual({ total: 2, confirmed: 2 });
  });

  it("確定は月をまたがない(他の月に波及しない)", async () => {
    ctx.insert.run("2026-05::24", "2026-05", "24", 0);
    ctx.insert.run("2026-04::24", "2026-04", "24", 0);
    const repo = new D1VehiclePlRepository(ctx.db);
    await repo.setConfirmed("2026-05", true);
    expect(await repo.getConfirmation("2026-04")).toEqual({ total: 1, confirmed: 0 });
  });

  it("setConfirmed(false) で確定を外せる", async () => {
    ctx.insert.run("2026-05::24", "2026-05", "24", 1);
    const repo = new D1VehiclePlRepository(ctx.db);
    await repo.setConfirmed("2026-05", false);
    expect(await repo.getConfirmation("2026-05")).toEqual({ total: 1, confirmed: 0 });
  });
});
