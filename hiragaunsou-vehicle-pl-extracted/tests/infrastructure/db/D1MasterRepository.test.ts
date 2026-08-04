import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import {
  D1VehicleMasterRepository,
  D1DriverMasterRepository,
  D1RateMasterRepository,
  RATE_KEYS,
} from "../../../src/infrastructure/db/D1MasterRepository";
import { DEFAULT_RATE_SETTINGS } from "../../../src/domain/rules/vehiclePlCalculation";
import { DEFAULT_DEFICIT_THRESHOLDS } from "../../../src/domain/rules/deficitClassification";

/**
 * D1RateMasterRepository.setRate / getRates は tests/infrastructure/newD1Methods.test.ts で
 * 一部検証済みだが、D1VehicleMasterRepository / D1DriverMasterRepository と
 * getDeficitThresholds は未検証(0%)だったため、ここでまとめて検証する。
 */
function insertVehicleMaster(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  row: { vehicleNo: string; vehicleType: string; active: number },
) {
  sqlite
    .prepare(
      `INSERT INTO vehicle_master (vehicle_no, vehicle_type, active) VALUES (@vehicleNo, @vehicleType, @active)`,
    )
    .run(row);
}

describe("D1VehicleMasterRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  describe("findAllActive", () => {
    it("active=trueの車両だけをマッピングして返す", async () => {
      insertVehicleMaster(ctx.sqlite, { vehicleNo: "24", vehicleType: "大型", active: 1 });
      insertVehicleMaster(ctx.sqlite, { vehicleNo: "300", vehicleType: "中型", active: 0 });
      const repo = new D1VehicleMasterRepository(ctx.db);
      const rows = await repo.findAllActive();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ vehicleNo: "24", vehicleType: "大型" });
    });

    it("該当なしは空配列", async () => {
      const repo = new D1VehicleMasterRepository(ctx.db);
      expect(await repo.findAllActive()).toEqual([]);
    });
  });

  describe("updateLeaseInstallment", () => {
    it("指定車番のlease/installmentだけを更新する(他の車番には影響しない)", async () => {
      insertVehicleMaster(ctx.sqlite, { vehicleNo: "24", vehicleType: "大型", active: 1 });
      insertVehicleMaster(ctx.sqlite, { vehicleNo: "300", vehicleType: "中型", active: 1 });
      const repo = new D1VehicleMasterRepository(ctx.db);
      await repo.updateLeaseInstallment("24", 50000, 30000);

      const row24 = ctx.sqlite.prepare("SELECT lease, installment FROM vehicle_master WHERE vehicle_no = '24'").get() as {
        lease: number;
        installment: number;
      };
      const row300 = ctx.sqlite.prepare("SELECT lease, installment FROM vehicle_master WHERE vehicle_no = '300'").get() as {
        lease: number;
        installment: number;
      };
      expect(row24).toEqual({ lease: 50000, installment: 30000 });
      expect(row300).toEqual({ lease: 0, installment: 0 });
    });
  });
});

describe("D1DriverMasterRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  it("運転者マスタの全件をマッピングして返す(車番未紐付けのnullも保持する)", async () => {
    insertVehicleMaster(ctx.sqlite, { vehicleNo: "24", vehicleType: "大型", active: 1 });
    ctx.sqlite
      .prepare(`INSERT INTO driver_master (employee_code, driver_name, vehicle_no) VALUES ('E1', '山田', '24')`)
      .run();
    ctx.sqlite
      .prepare(`INSERT INTO driver_master (employee_code, driver_name, vehicle_no) VALUES ('E2', '諸口', NULL)`)
      .run();
    const repo = new D1DriverMasterRepository(ctx.db);
    const rows = await repo.findAll();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.employeeCode === "E2")?.vehicleNo).toBeNull();
  });

  it("該当なしは空配列", async () => {
    const repo = new D1DriverMasterRepository(ctx.db);
    expect(await repo.findAll()).toEqual([]);
  });
});

describe("D1RateMasterRepository.getDeficitThresholds", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  it("未設定なら既定値(DEFAULT_DEFICIT_THRESHOLDS)にフォールバックする", async () => {
    const repo = new D1RateMasterRepository(ctx.db);
    expect(await repo.getDeficitThresholds("2026-05")).toEqual(DEFAULT_DEFICIT_THRESHOLDS);
  });

  it("月指定値があればそれを優先し、無いキーは既定値のまま返す", async () => {
    const repo = new D1RateMasterRepository(ctx.db);
    await repo.setRate(RATE_KEYS.idleSales, "2026-05", 123456, null);
    const thresholds = await repo.getDeficitThresholds("2026-05");
    expect(thresholds.idleSales).toBe(123456);
    expect(thresholds.repairSpike).toBe(DEFAULT_DEFICIT_THRESHOLDS.repairSpike);
    expect(thresholds.breakEvenKmPrice).toBe(DEFAULT_DEFICIT_THRESHOLDS.breakEvenKmPrice);
  });

  it("全期間共通値(yearMonth=null)は月指定が無い月にも適用される", async () => {
    const repo = new D1RateMasterRepository(ctx.db);
    await repo.setRate(RATE_KEYS.repairSpike, null, 99999, null);
    expect((await repo.getDeficitThresholds("2026-05")).repairSpike).toBe(99999);
    expect((await repo.getDeficitThresholds("2026-06")).repairSpike).toBe(99999);
  });
});

describe("D1RateMasterRepository.getRates", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  it("未設定なら既定値(DEFAULT_RATE_SETTINGS)を返す", async () => {
    const repo = new D1RateMasterRepository(ctx.db);
    expect(await repo.getRates("2026-05")).toEqual(DEFAULT_RATE_SETTINGS);
  });

  it("月指定値が全期間共通値より優先される", async () => {
    const repo = new D1RateMasterRepository(ctx.db);
    await repo.setRate(RATE_KEYS.tankPricePerLiter, null, 100, null);
    await repo.setRate(RATE_KEYS.tankPricePerLiter, "2026-05", 130, null);
    expect((await repo.getRates("2026-05")).tankPricePerLiter).toBe(130);
    expect((await repo.getRates("2026-06")).tankPricePerLiter).toBe(100);
  });
});
