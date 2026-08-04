import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import type { VehiclePlCalculated } from "../../../src/domain/rules/vehiclePlCalculation";

/**
 * getConfirmation / setConfirmed は tests/infrastructure/vehiclePlConfirmation.test.ts で
 * 既に検証済みのため、ここでは検索系(findByYearMonth 等)と upsertMany(batch())の境界を検証する。
 */
function insertVehiclePl(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  row: { id: string; yearMonth: string; vehicleNo: string; sales: number; profit: number },
) {
  sqlite
    .prepare(
      `INSERT INTO vehicle_pl (id, year_month, vehicle_no, sales, profit) VALUES (@id, @yearMonth, @vehicleNo, @sales, @profit)`,
    )
    .run(row);
}

describe("D1VehiclePlRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  describe("findByYearMonth", () => {
    it("該当月の行を全フィールドマッピングして返す", async () => {
      insertVehiclePl(ctx.sqlite, { id: "1", yearMonth: "2026-05", vehicleNo: "24", sales: 100000, profit: 20000 });
      const repo = new D1VehiclePlRepository(ctx.db);
      const rows = await repo.findByYearMonth("2026-05");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ no: "24", sales: 100000, profit: 20000 });
    });

    it("該当なしは空配列", async () => {
      const repo = new D1VehiclePlRepository(ctx.db);
      expect(await repo.findByYearMonth("2026-05")).toEqual([]);
    });
  });

  describe("findByVehicleNo", () => {
    it("車番一致の行を月をまたいで全て返す", async () => {
      insertVehiclePl(ctx.sqlite, { id: "1", yearMonth: "2026-04", vehicleNo: "24", sales: 1, profit: 1 });
      insertVehiclePl(ctx.sqlite, { id: "2", yearMonth: "2026-05", vehicleNo: "24", sales: 2, profit: 2 });
      insertVehiclePl(ctx.sqlite, { id: "3", yearMonth: "2026-05", vehicleNo: "300", sales: 3, profit: 3 });
      const repo = new D1VehiclePlRepository(ctx.db);
      const rows = await repo.findByVehicleNo("24");
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.sales).sort()).toEqual([1, 2]);
    });
  });

  describe("findByYearMonths", () => {
    it("空配列を渡すとクエリを発行せず空のMapを返す", async () => {
      const repo = new D1VehiclePlRepository(ctx.db);
      expect(await repo.findByYearMonths([])).toEqual(new Map());
    });

    it("要求した月は結果が0件でも空配列で初期化される(未初期化キーへの誤混入を防ぐ)", async () => {
      insertVehiclePl(ctx.sqlite, { id: "1", yearMonth: "2026-05", vehicleNo: "24", sales: 1, profit: 1 });
      const repo = new D1VehiclePlRepository(ctx.db);
      const result = await repo.findByYearMonths(["2026-04", "2026-05"]);
      expect([...result.keys()]).toEqual(["2026-04", "2026-05"]);
      expect(result.get("2026-04")).toEqual([]);
      expect(result.get("2026-05")).toHaveLength(1);
    });
  });

  describe("countByYearMonth", () => {
    it("行が無ければ0を返す", async () => {
      const repo = new D1VehiclePlRepository(ctx.db);
      expect(await repo.countByYearMonth("2026-05")).toBe(0);
    });

    it("該当月の件数を数える", async () => {
      insertVehiclePl(ctx.sqlite, { id: "1", yearMonth: "2026-05", vehicleNo: "24", sales: 1, profit: 1 });
      insertVehiclePl(ctx.sqlite, { id: "2", yearMonth: "2026-05", vehicleNo: "300", sales: 1, profit: 1 });
      insertVehiclePl(ctx.sqlite, { id: "3", yearMonth: "2026-04", vehicleNo: "24", sales: 1, profit: 1 });
      const repo = new D1VehiclePlRepository(ctx.db);
      expect(await repo.countByYearMonth("2026-05")).toBe(2);
    });
  });

  describe("upsertMany", () => {
    it("rows.length===0のときは何もせず正常終了する", async () => {
      const repo = new D1VehiclePlRepository(ctx.db);
      await expect(repo.upsertMany("2026-05", [])).resolves.toBeUndefined();
    });

    it("1件以上ではD1固有の.batch()を呼ぶため、better-sqlite3ドライバでは例外になる", async () => {
      const repo = new D1VehiclePlRepository(ctx.db);
      const row: VehiclePlCalculated = {
        no: "24",
        type: "",
        depot: "",
        reg: null,
        code: null,
        driver: null,
        trips: 0,
        slips: 0,
        hours: 0,
        km: 0,
        fare: 0,
        fee: 0,
        sales: 0,
        toll: 0,
        tollDisc: 0,
        tollNet: 0,
        fuelIn: 0,
        fuelInQty: 0,
        fuelOut: 0,
        fuelOutQty: 0,
        fuelQty: 0,
        nempi: 0,
        adblue: 0,
        fuelTotal: 0,
        repair: 0,
        repairStandard: 0,
        tire: 0,
        equip: 0,
        mainte: 0,
        repairTotal: 0,
        salary: 0,
        bonus: 0,
        welfare: 0,
        laborTotal: 0,
        insCompulsory: 0,
        insVoluntary: 0,
        insTotal: 0,
        taxAuto: 0,
        taxWeight: 0,
        taxTotal: 0,
        miscOther: 0,
        miscTotal: 0,
        lease: 0,
        installment: 0,
        transportTotal: 0,
        adminFee: 0,
        adminTotal: 0,
        fixed: 0,
        variable: 0,
        expense: 0,
        profit: 0,
        margin: 0,
      };
      await expect(repo.upsertMany("2026-05", [row])).rejects.toThrow();
    });
  });
});
