import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { manualVehicleInput } from "./schema";
import type {
  ManualInputRecord,
  ManualInputRepository,
} from "../../domain/repositories/ManualInputRepository";

/**
 * D1(Drizzle)による ManualInputRepository の実装(Infrastructure層アダプタ)。
 * year_month + vehicle_no の一意制約で upsert するため、何度保存しても行が増えない
 * (=入力途中の保存を繰り返しても壊れない)。
 */
export class D1ManualInputRepository implements ManualInputRepository {
  constructor(private readonly db: Db) {}

  async findByYearMonth(yearMonth: string): Promise<ManualInputRecord[]> {
    const rows = await this.db
      .select()
      .from(manualVehicleInput)
      .where(eq(manualVehicleInput.yearMonth, yearMonth));

    return rows.map((r) => ({
      vehicleNo: r.vehicleNo,
      fuelInQty: r.fuelInQty,
      fuelOut: r.fuelOut,
      fuelOutQty: r.fuelOutQty,
      adblue: r.adblue,
      repairActual: r.repairActual,
      tireActual: r.tireActual,
      equip: r.equip,
      mainte: r.mainte,
      tollActual: r.tollActual,
      tollDiscountActual: r.tollDiscountActual,
      miscOther: r.miscOther,
    }));
  }

  async upsertMany(
    yearMonth: string,
    records: readonly ManualInputRecord[],
    updatedBy: string | null,
  ): Promise<void> {
    if (records.length === 0) return;
    const now = new Date();
    const statements = records.map((record) =>
      this.db
        .insert(manualVehicleInput)
        .values({
          id: `${yearMonth}::${record.vehicleNo}`,
          yearMonth,
          vehicleNo: record.vehicleNo,
          fuelInQty: record.fuelInQty,
          fuelOut: record.fuelOut,
          fuelOutQty: record.fuelOutQty,
          adblue: record.adblue,
          repairActual: record.repairActual,
          tireActual: record.tireActual,
          equip: record.equip,
          mainte: record.mainte,
          tollActual: record.tollActual,
          tollDiscountActual: record.tollDiscountActual,
          miscOther: record.miscOther,
          updatedAt: now,
          updatedBy,
        })
        .onConflictDoUpdate({
          target: [manualVehicleInput.yearMonth, manualVehicleInput.vehicleNo],
          set: {
            fuelInQty: record.fuelInQty,
            fuelOut: record.fuelOut,
            fuelOutQty: record.fuelOutQty,
            adblue: record.adblue,
            repairActual: record.repairActual,
            tireActual: record.tireActual,
            equip: record.equip,
            mainte: record.mainte,
            tollActual: record.tollActual,
            tollDiscountActual: record.tollDiscountActual,
            miscOther: record.miscOther,
            updatedAt: now,
            updatedBy,
          },
        }),
    );
    // D1に対話型トランザクションはないため batch() で原子性を担保する
    await this.db.batch(statements as unknown as [(typeof statements)[number]]);
  }
}
