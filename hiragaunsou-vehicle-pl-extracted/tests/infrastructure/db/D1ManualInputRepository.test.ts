import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1ManualInputRepository } from "../../../src/infrastructure/db/D1ManualInputRepository";
import type { ManualInputRecord } from "../../../src/domain/repositories/ManualInputRepository";

function insertManualInput(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  row: {
    id: string;
    yearMonth: string;
    vehicleNo: string;
    fuelInQty: number;
    fuelOut: number;
    fuelOutQty: number;
    adblue: number;
    repairActual: number;
    tireActual: number | null;
    equip: number;
    mainte: number;
    tollActual: number | null;
    tollDiscountActual: number | null;
    miscOther: number;
  },
) {
  sqlite
    .prepare(
      `INSERT INTO manual_vehicle_input
        (id, year_month, vehicle_no, fuel_in_qty, fuel_out, fuel_out_qty, adblue,
         repair_actual, tire_actual, equip, mainte, toll_actual, toll_discount_actual, misc_other)
       VALUES (@id, @yearMonth, @vehicleNo, @fuelInQty, @fuelOut, @fuelOutQty, @adblue,
         @repairActual, @tireActual, @equip, @mainte, @tollActual, @tollDiscountActual, @miscOther)`,
    )
    .run(row);
}

describe("D1ManualInputRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  describe("findByYearMonth", () => {
    it("該当月の入力が無ければ空配列を返す", async () => {
      const repo = new D1ManualInputRepository(ctx.db);
      expect(await repo.findByYearMonth("2026-05")).toEqual([]);
    });

    it("null許容フィールド(tireActual等)をnullのまま返す(標準原価フォールバック判定に必要)", async () => {
      insertManualInput(ctx.sqlite, {
        id: "2026-05::24",
        yearMonth: "2026-05",
        vehicleNo: "24",
        fuelInQty: 100,
        fuelOut: 5000,
        fuelOutQty: 30,
        adblue: 1000,
        repairActual: 20000,
        tireActual: null,
        equip: 0,
        mainte: 0,
        tollActual: null,
        tollDiscountActual: null,
        miscOther: 0,
      });
      const repo = new D1ManualInputRepository(ctx.db);
      const rows = await repo.findByYearMonth("2026-05");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        vehicleNo: "24",
        fuelInQty: 100,
        fuelOut: 5000,
        fuelOutQty: 30,
        adblue: 1000,
        repairActual: 20000,
        tireActual: null,
        equip: 0,
        mainte: 0,
        tollActual: null,
        tollDiscountActual: null,
        miscOther: 0,
      });
    });

    it("他の月の入力は含めない", async () => {
      insertManualInput(ctx.sqlite, {
        id: "2026-04::24",
        yearMonth: "2026-04",
        vehicleNo: "24",
        fuelInQty: 1,
        fuelOut: 1,
        fuelOutQty: 1,
        adblue: 1,
        repairActual: 1,
        tireActual: 1,
        equip: 1,
        mainte: 1,
        tollActual: 1,
        tollDiscountActual: 1,
        miscOther: 1,
      });
      const repo = new D1ManualInputRepository(ctx.db);
      expect(await repo.findByYearMonth("2026-05")).toEqual([]);
    });
  });

  describe("upsertMany", () => {
    it("recordsが空配列のときは何もせず正常終了する", async () => {
      const repo = new D1ManualInputRepository(ctx.db);
      await expect(repo.upsertMany("2026-05", [], null)).resolves.toBeUndefined();
    });

    it("1件以上ではD1固有の.batch()を呼ぶため、better-sqlite3ドライバでは例外になる", async () => {
      const repo = new D1ManualInputRepository(ctx.db);
      const record: ManualInputRecord = {
        vehicleNo: "24",
        fuelInQty: 100,
        fuelOut: 5000,
        fuelOutQty: 30,
        adblue: 1000,
        repairActual: 20000,
        tireActual: null,
        equip: 0,
        mainte: 0,
        tollActual: null,
        tollDiscountActual: null,
        miscOther: 0,
      };
      await expect(repo.upsertMany("2026-05", [record], null)).rejects.toThrow();
    });
  });
});
