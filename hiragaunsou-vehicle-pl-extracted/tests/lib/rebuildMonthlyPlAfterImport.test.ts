import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "../infrastructure/db/testDbHelper";
import { rebuildMonthlyPlAfterImport } from "../../app/_lib/monthlyPlRecalculator";

/**
 * 取込後に収支表の下地を作る処理の分岐を、実マイグレーションを流した in-memory DB で検証する。
 *
 * ここで一番守りたいのは「車両マスタが空のときに成功を返さない」こと。
 * 0台で成功を返していたため、取込は全部済んでいるのに手入力・月次収支表・年間集計が空、
 * という状態から利用者が抜け出せなくなっていた(取込をやり直しても結果は変わらない)。
 */

/**
 * better-sqlite3 ドライバには D1 の `.batch()` が無い。
 * drizzle のクエリビルダは then 可能なので、順に実行して同じ結果にする
 * (テスト内での原子性は問わない)。
 */
function withBatch(db: Record<string, unknown>) {
  db.batch = async (statements: PromiseLike<unknown>[]) => {
    const results: unknown[] = [];
    for (const statement of statements) results.push(await statement);
    return results;
  };
  return db;
}

const YM = "2026-05";

describe("rebuildMonthlyPlAfterImport (取込後の収支表づくり)", () => {
  let ctx: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    ctx = createTestDb();
    withBatch(ctx.db);
  });

  /** 取込済みの記録(csv_import_batch)を1件作る。 */
  function addImportBatch(sourceType: string) {
    ctx.sqlite
      .prepare(
        `INSERT INTO csv_import_batch (id, source_type, year_month, file_name, row_count, imported_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(`${sourceType}-${YM}`, sourceType, YM, `${sourceType}.xlsx`, 10, Date.now());
  }

  function addVehicle(vehicleNo: string) {
    ctx.sqlite
      .prepare(
        `INSERT INTO vehicle_master (vehicle_no, vehicle_type, cost_category, active, updated_at)
         VALUES (?, '大型', 'large', 1, ?)`,
      )
      .run(vehicleNo, Date.now());
  }

  it("運行実績しか無い月では作らない(材料が揃っていない)", async () => {
    addImportBatch("vehicle_operation");
    addVehicle("24");
    expect(await rebuildMonthlyPlAfterImport(ctx.db, YM)).toEqual({
      status: "skipped",
      reason: "imports_incomplete",
    });
  });

  it("車両マスタが空なら成功扱いにせず、真因を名指しして返す", async () => {
    addImportBatch("vehicle_operation");
    addImportBatch("sales_monitor");
    const result = await rebuildMonthlyPlAfterImport(ctx.db, YM);
    expect(result).toEqual({ status: "skipped", reason: "no_vehicle_master" });
    // 0台で「作れた」と言わない。ここが崩れると画面は「0台分作りました」としか出せない。
    expect(result.status).not.toBe("built");
  });

  it("材料と車両マスタが揃えば、その月の収支表の行ができる", async () => {
    addImportBatch("vehicle_operation");
    addImportBatch("sales_monitor");
    addVehicle("24");
    addVehicle("300");

    const result = await rebuildMonthlyPlAfterImport(ctx.db, YM);
    expect(result).toEqual({ status: "built", vehicleCount: 2 });

    const rows = ctx.sqlite
      .prepare("SELECT vehicle_no FROM vehicle_pl WHERE year_month = ? ORDER BY vehicle_no")
      .all(YM) as { vehicle_no: string }[];
    expect(rows.map((r) => r.vehicle_no)).toEqual(["24", "300"]);
  });

  it("確定済みの月は作り直さない(締めた数字を黙って動かさない)", async () => {
    addImportBatch("vehicle_operation");
    addImportBatch("sales_monitor");
    addVehicle("24");
    ctx.sqlite
      .prepare(
        `INSERT INTO vehicle_pl (id, year_month, vehicle_no, confirmed, updated_at) VALUES (?, ?, ?, 1, ?)`,
      )
      .run(`${YM}::24`, YM, "24", Date.now());

    expect(await rebuildMonthlyPlAfterImport(ctx.db, YM)).toEqual({
      status: "skipped",
      reason: "confirmed",
    });
  });
});
