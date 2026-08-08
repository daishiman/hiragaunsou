import { and, eq } from "drizzle-orm";
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

  async findByYearMonth(yearMonth: string): Promise<VehiclePlOverrideRecord[]> {
    const rows = await this.db
      .select({
        vehicleNo: vehiclePlOverride.vehicleNo,
        excluded: vehiclePlOverride.excluded,
        valuesJson: vehiclePlOverride.valuesJson,
        reason: vehiclePlOverride.reason,
        updatedAt: vehiclePlOverride.updatedAt,
        updatedByName: user.name,
      })
      .from(vehiclePlOverride)
      .leftJoin(user, eq(vehiclePlOverride.updatedBy, user.id))
      .where(eq(vehiclePlOverride.yearMonth, yearMonth));

    return rows.map((r) => ({
      vehicleNo: r.vehicleNo,
      excluded: r.excluded,
      values: parseOverrideValues(r.valuesJson),
      reason: r.reason,
      updatedAt: r.updatedAt,
      updatedByName: r.updatedByName ?? null,
    }));
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
      })
      .onConflictDoUpdate({
        target: [vehiclePlOverride.yearMonth, vehiclePlOverride.vehicleNo],
        set: {
          excluded: override.excluded,
          valuesJson,
          reason: override.reason,
          updatedAt: now,
          updatedBy,
        },
      });
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
