import { eq, and, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { vehicleMaster, driverMaster, rateMaster } from "./schema";
import type {
  VehicleMasterRepository,
  VehicleMasterRecord,
  DriverMasterRepository,
  DriverMasterRecord,
  RateMasterRepository,
} from "../../domain/repositories/MasterRepository";
import { DEFAULT_RATE_SETTINGS, type RateSettings } from "../../domain/rules/vehiclePlCalculation";

/** D1(Drizzle)によるVehicleMasterRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1VehicleMasterRepository implements VehicleMasterRepository {
  constructor(private readonly db: Db) {}

  async findAllActive(): Promise<VehicleMasterRecord[]> {
    const rows = await this.db.select().from(vehicleMaster).where(eq(vehicleMaster.active, true));
    return rows.map((r) => ({
      vehicleNo: r.vehicleNo,
      vehicleType: r.vehicleType,
      depot: r.depot,
      regDate: r.regDate,
      costCategory: r.costCategory,
      insCompulsory: r.insCompulsory,
      insVoluntary: r.insVoluntary,
      taxAuto: r.taxAuto,
      taxWeight: r.taxWeight,
      lease: r.lease,
      installment: r.installment,
    }));
  }
}

/** D1(Drizzle)によるDriverMasterRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1DriverMasterRepository implements DriverMasterRepository {
  constructor(private readonly db: Db) {}

  async findAll(): Promise<DriverMasterRecord[]> {
    const rows = await this.db.select().from(driverMaster);
    return rows.map((r) => ({
      employeeCode: r.employeeCode,
      driverName: r.driverName,
      vehicleNo: r.vehicleNo,
    }));
  }
}

export const RATE_KEYS = {
  tollDiscountRate: "toll_discount_rate",
  adminFeeRate: "admin_fee_rate",
  bonusAnnual: "bonus_annual",
  tankPricePerLiter: "tank_price",
} as const;

/** D1(Drizzle)によるRateMasterRepositoryの実装。yearMonth指定値→全期間共通値→デフォルトの順でフォールバックする。 */
export class D1RateMasterRepository implements RateMasterRepository {
  constructor(private readonly db: Db) {}

  async getRates(yearMonth: string): Promise<RateSettings> {
    const rows = await this.db.select().from(rateMaster);

    const resolve = (key: string, fallback: number): number => {
      const monthly = rows.find((r) => r.key === key && r.yearMonth === yearMonth);
      if (monthly) return monthly.value;
      const common = rows.find((r) => r.key === key && r.yearMonth === null);
      if (common) return common.value;
      return fallback;
    };

    return {
      tollDiscountRate: resolve(RATE_KEYS.tollDiscountRate, DEFAULT_RATE_SETTINGS.tollDiscountRate),
      adminFeeRate: resolve(RATE_KEYS.adminFeeRate, DEFAULT_RATE_SETTINGS.adminFeeRate),
      bonusAnnual: resolve(RATE_KEYS.bonusAnnual, DEFAULT_RATE_SETTINGS.bonusAnnual),
      tankPricePerLiter: resolve(RATE_KEYS.tankPricePerLiter, DEFAULT_RATE_SETTINGS.tankPricePerLiter),
    };
  }

  async setRate(
    key: string,
    yearMonth: string | null,
    value: number,
    updatedBy: string | null,
  ): Promise<void> {
    const existing = await this.db
      .select()
      .from(rateMaster)
      .where(
        yearMonth === null
          ? and(eq(rateMaster.key, key), isNull(rateMaster.yearMonth))
          : and(eq(rateMaster.key, key), eq(rateMaster.yearMonth, yearMonth)),
      )
      .limit(1);

    const now = new Date();
    if (existing[0]) {
      await this.db
        .update(rateMaster)
        .set({ value, updatedAt: now, updatedBy })
        .where(eq(rateMaster.id, existing[0].id));
      return;
    }

    await this.db.insert(rateMaster).values({
      id: crypto.randomUUID(),
      key,
      yearMonth,
      value,
      updatedAt: now,
      updatedBy,
    });
  }
}
