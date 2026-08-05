import { eq, and, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { vehicleMaster, driverMaster, rateMaster } from "./schema";
import type {
  VehicleMasterRepository,
  VehicleMasterRecord,
  VehicleMasterUpsertInput,
  DriverMasterRepository,
  DriverMasterRecord,
  RateMasterRepository,
} from "../../domain/repositories/MasterRepository";
import { DEFAULT_RATE_SETTINGS, type RateSettings } from "../../domain/rules/vehiclePlCalculation";
import {
  DEFAULT_DEFICIT_THRESHOLDS,
  type DeficitThresholds,
} from "../../domain/rules/deficitClassification";

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

  async upsertMany(
    records: VehicleMasterUpsertInput[],
  ): Promise<{ inserted: number; updated: number }> {
    if (records.length === 0) return { inserted: 0, updated: 0 };

    // 新規/更新の内訳は upsert 後には判別できないため、先に既存の車番を1クエリで押さえておく。
    const existingRows = await this.db
      .select({ vehicleNo: vehicleMaster.vehicleNo })
      .from(vehicleMaster);
    const existing = new Set(existingRows.map((r) => r.vehicleNo));

    const now = new Date();
    let inserted = 0;
    let updated = 0;
    for (const record of records) {
      await this.db
        .insert(vehicleMaster)
        .values({ ...record, active: true, updatedAt: now })
        .onConflictDoUpdate({
          target: vehicleMaster.vehicleNo,
          set: {
            vehicleType: record.vehicleType,
            depot: record.depot,
            costCategory: record.costCategory,
            insCompulsory: record.insCompulsory,
            insVoluntary: record.insVoluntary,
            taxAuto: record.taxAuto,
            taxWeight: record.taxWeight,
            lease: record.lease,
            installment: record.installment,
            // 一度 active=false にした車両でも、CSVに載っている以上は現役として扱う
            active: true,
            updatedAt: now,
          },
        });
      if (existing.has(record.vehicleNo)) updated++;
      else inserted++;
    }
    return { inserted, updated };
  }

  async updateLeaseInstallment(
    vehicleNo: string,
    lease: number,
    installment: number,
  ): Promise<void> {
    await this.db
      .update(vehicleMaster)
      .set({ lease, installment, updatedAt: new Date() })
      .where(eq(vehicleMaster.vehicleNo, vehicleNo));
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
  /** 赤字3分類: 売上がこれ未満なら遊休・低稼働型 */
  idleSales: "deficit_idle_sales",
  /** 赤字3分類: 修理費実費がこれ以上なら突発修繕型 */
  repairSpike: "deficit_repair_spike",
  /** 損益分岐目安のkm単価 (ダッシュボードのkm単価分布の閾線) */
  breakEvenKmPrice: "break_even_km_price",
} as const;

/** D1(Drizzle)によるRateMasterRepositoryの実装。yearMonth指定値→全期間共通値→デフォルトの順でフォールバックする。 */
export class D1RateMasterRepository implements RateMasterRepository {
  constructor(private readonly db: Db) {}

  /** 月指定値→全期間共通値→既定値 の順で解決する関数を作る (1クエリで全キーを賄う) */
  private async resolver(yearMonth: string): Promise<(key: string, fallback: number) => number> {
    const rows = await this.db.select().from(rateMaster);
    return (key: string, fallback: number): number => {
      const monthly = rows.find((r) => r.key === key && r.yearMonth === yearMonth);
      if (monthly) return monthly.value;
      const common = rows.find((r) => r.key === key && r.yearMonth === null);
      if (common) return common.value;
      return fallback;
    };
  }

  async getRates(yearMonth: string): Promise<RateSettings> {
    const resolve = await this.resolver(yearMonth);

    return {
      tollDiscountRate: resolve(RATE_KEYS.tollDiscountRate, DEFAULT_RATE_SETTINGS.tollDiscountRate),
      adminFeeRate: resolve(RATE_KEYS.adminFeeRate, DEFAULT_RATE_SETTINGS.adminFeeRate),
      bonusAnnual: resolve(RATE_KEYS.bonusAnnual, DEFAULT_RATE_SETTINGS.bonusAnnual),
      tankPricePerLiter: resolve(RATE_KEYS.tankPricePerLiter, DEFAULT_RATE_SETTINGS.tankPricePerLiter),
    };
  }

  async getDeficitThresholds(yearMonth: string): Promise<DeficitThresholds> {
    const resolve = await this.resolver(yearMonth);
    return {
      idleSales: resolve(RATE_KEYS.idleSales, DEFAULT_DEFICIT_THRESHOLDS.idleSales),
      repairSpike: resolve(RATE_KEYS.repairSpike, DEFAULT_DEFICIT_THRESHOLDS.repairSpike),
      breakEvenKmPrice: resolve(
        RATE_KEYS.breakEvenKmPrice,
        DEFAULT_DEFICIT_THRESHOLDS.breakEvenKmPrice,
      ),
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
