import { and, count, eq, isNull, lte } from "drizzle-orm";
import type { Db } from "./client";
import { vehiclePlOverride } from "./schema";
import { user } from "./auth-schema";
import type {
  VehiclePlOverrideRecord,
  VehiclePlOverrideRepository,
} from "../../domain/repositories/VehiclePlOverrideRepository";
import {
  parseOverrideValues,
  type VehiclePlOverride,
} from "../../domain/rules/vehiclePlOverride";

/**
 * D1(Drizzle)による VehiclePlOverrideRepository の実装(Infrastructure層アダプタ)。
 *
 * 上書きは「なぜ直したか」が失われると次の月に判断を引き継げないため、
 * 直した人の名前を join して返す (updated_by だけでは画面で名前が出せない)。
 */
export class D1VehiclePlOverrideRepository implements VehiclePlOverrideRepository {
  constructor(private readonly db: Db) {}

  private select() {
    return this.db
      .select({
        vehicleNo: vehiclePlOverride.vehicleNo,
        excluded: vehiclePlOverride.excluded,
        valuesJson: vehiclePlOverride.valuesJson,
        reason: vehiclePlOverride.reason,
        updatedAt: vehiclePlOverride.updatedAt,
        appliedAt: vehiclePlOverride.appliedAt,
        updatedByName: user.name,
      })
      .from(vehiclePlOverride)
      .leftJoin(user, eq(vehiclePlOverride.updatedBy, user.id));
  }

  private toRecord(r: {
    vehicleNo: string;
    excluded: boolean;
    valuesJson: string;
    reason: string;
    updatedAt: Date;
    appliedAt: Date | null;
    updatedByName: string | null;
  }): VehiclePlOverrideRecord {
    return {
      vehicleNo: r.vehicleNo,
      excluded: r.excluded,
      values: parseOverrideValues(r.valuesJson),
      reason: r.reason,
      updatedAt: r.updatedAt,
      updatedByName: r.updatedByName ?? null,
      appliedAt: r.appliedAt,
    };
  }

  async findByYearMonth(yearMonth: string): Promise<VehiclePlOverrideRecord[]> {
    const rows = await this.select().where(eq(vehiclePlOverride.yearMonth, yearMonth));
    return rows.map((r) => this.toRecord(r));
  }

  async findOne(yearMonth: string, vehicleNo: string): Promise<VehiclePlOverrideRecord | null> {
    const rows = await this.select()
      .where(
        and(
          eq(vehiclePlOverride.yearMonth, yearMonth),
          eq(vehiclePlOverride.vehicleNo, vehicleNo),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? this.toRecord(row) : null;
  }

  async save(
    yearMonth: string,
    override: VehiclePlOverride,
    updatedBy: string | null,
  ): Promise<void> {
    const now = new Date();
    const valuesJson = JSON.stringify(override.values);
    await this.db
      .insert(vehiclePlOverride)
      .values({
        id: `${yearMonth}::${override.vehicleNo}`,
        yearMonth,
        vehicleNo: override.vehicleNo,
        excluded: override.excluded,
        valuesJson,
        reason: override.reason,
        updatedAt: now,
        updatedBy,
        // 保存しただけでは収支表の数字は変わらない。反映済みの印を必ず外し、
        // 「反映待ち」として画面に出るようにする。
        appliedAt: null,
      })
      .onConflictDoUpdate({
        target: [vehiclePlOverride.yearMonth, vehiclePlOverride.vehicleNo],
        set: {
          excluded: override.excluded,
          valuesJson,
          reason: override.reason,
          updatedAt: now,
          updatedBy,
          appliedAt: null,
        },
      });
  }

  async countPending(yearMonth: string): Promise<number> {
    const rows = await this.db
      .select({ count: count() })
      .from(vehiclePlOverride)
      .where(
        and(eq(vehiclePlOverride.yearMonth, yearMonth), isNull(vehiclePlOverride.appliedAt)),
      );
    return rows[0]?.count ?? 0;
  }

  async markApplied(yearMonth: string, asOf: Date): Promise<void> {
    await this.db
      .update(vehiclePlOverride)
      .set({ appliedAt: asOf })
      .where(
        and(
          eq(vehiclePlOverride.yearMonth, yearMonth),
          lte(vehiclePlOverride.updatedAt, asOf),
        ),
      );
  }

  async remove(yearMonth: string, vehicleNo: string): Promise<void> {
    await this.db
      .delete(vehiclePlOverride)
      .where(
        and(
          eq(vehiclePlOverride.yearMonth, yearMonth),
          eq(vehiclePlOverride.vehicleNo, vehicleNo),
        ),
      );
  }
}
