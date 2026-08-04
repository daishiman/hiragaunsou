import { count, eq, getTableColumns, inArray, sql, sum, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { vehiclePl } from "./schema";
import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";

/**
 * 競合時の更新値。挿入しようとした行を指す `excluded."列名"` を使うため、
 * バインドパラメータを1個も消費しない。
 * これがないと 1行 = 55(挿入) + 52(更新) = 107個となり、D1の上限100を1行でも超えてしまう。
 * 併せて列リストの二重管理もなくなり、列追加時の更新漏れが構造的に起きなくなる。
 *
 * id / year_month / vehicle_no はキーなので更新しない。
 * confirmed は作り直したら外す (確定済みの表と中身がずれたまま残さない)。
 * 定数 0 を直に埋め込むため、こちらもパラメータを消費しない。
 */
const CONFLICT_UPDATE_SET = (() => {
  const { id, yearMonth, vehicleNo, confirmed, ...updatable } = getTableColumns(vehiclePl);
  void id;
  void yearMonth;
  void vehicleNo;
  void confirmed;
  return {
    ...Object.fromEntries(
      Object.entries(updatable).map(([key, column]) => [key, sql.raw(`excluded."${column.name}"`)]),
    ),
    confirmed: sql.raw("0"),
  } as { [K in keyof typeof updatable]: SQL } & { confirmed: SQL };
})();

/** D1(Drizzle)によるVehiclePlRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1VehiclePlRepository implements VehiclePlRepository {
  constructor(private readonly db: Db) {}

  async upsertMany(yearMonth: string, rows: VehiclePlCalculated[]): Promise<void> {
    if (rows.length === 0) return;
    const now = new Date();
    const statements = rows.map((row) =>
      this.db
        .insert(vehiclePl)
        .values({
          id: `${yearMonth}::${row.no}`,
          yearMonth,
          vehicleNo: row.no,
          type: row.type,
          depot: row.depot,
          reg: row.reg,
          code: row.code,
          driver: row.driver,
          trips: row.trips,
          slips: row.slips,
          hours: row.hours,
          km: row.km,
          fare: row.fare,
          fee: row.fee,
          sales: row.sales,
          toll: row.toll,
          tollDisc: row.tollDisc,
          tollNet: row.tollNet,
          fuelIn: row.fuelIn,
          fuelInQty: row.fuelInQty,
          fuelOut: row.fuelOut,
          fuelOutQty: row.fuelOutQty,
          fuelQty: row.fuelQty,
          nempi: row.nempi,
          adblue: row.adblue,
          fuelTotal: row.fuelTotal,
          repair: row.repair,
          repairStandard: row.repairStandard,
          tire: row.tire,
          equip: row.equip,
          mainte: row.mainte,
          repairTotal: row.repairTotal,
          salary: row.salary,
          bonus: row.bonus,
          welfare: row.welfare,
          laborTotal: row.laborTotal,
          insCompulsory: row.insCompulsory,
          insVoluntary: row.insVoluntary,
          insTotal: row.insTotal,
          taxAuto: row.taxAuto,
          taxWeight: row.taxWeight,
          taxTotal: row.taxTotal,
          miscOther: row.miscOther,
          miscTotal: row.miscTotal,
          lease: row.lease,
          installment: row.installment,
          transportTotal: row.transportTotal,
          adminFee: row.adminFee,
          adminTotal: row.adminTotal,
          fixed: row.fixed,
          variable: row.variable,
          expense: row.expense,
          profit: row.profit,
          margin: row.margin,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [vehiclePl.yearMonth, vehiclePl.vehicleNo],
          set: CONFLICT_UPDATE_SET,
        }),
    );
    // D1に対話型トランザクションはないため batch() で原子性を担保する
    await this.db.batch(statements as unknown as [typeof statements[number]]);
  }

  async findByYearMonth(yearMonth: string): Promise<VehiclePlCalculated[]> {
    const rows = await this.db.select().from(vehiclePl).where(eq(vehiclePl.yearMonth, yearMonth));
    return rows.map(mapRow);
  }

  async findByVehicleNo(vehicleNo: string): Promise<VehiclePlCalculated[]> {
    const rows = await this.db.select().from(vehiclePl).where(eq(vehiclePl.vehicleNo, vehicleNo));
    return rows.map(mapRow);
  }

  async findByYearMonths(
    yearMonths: readonly string[],
  ): Promise<Map<string, VehiclePlCalculated[]>> {
    const result = new Map<string, VehiclePlCalculated[]>();
    for (const ym of yearMonths) result.set(ym, []);
    if (yearMonths.length === 0) return result;

    const rows = await this.db
      .select()
      .from(vehiclePl)
      .where(inArray(vehiclePl.yearMonth, [...yearMonths]));
    for (const row of rows) {
      // 要求外の月がヒットすることはないが、Map初期化済みキーにのみ積む
      result.get(row.yearMonth)?.push(mapRow(row));
    }
    return result;
  }

  async countByYearMonth(yearMonth: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(vehiclePl)
      .where(eq(vehiclePl.yearMonth, yearMonth));
    return rows[0]?.value ?? 0;
  }

  async getConfirmation(yearMonth: string): Promise<{ total: number; confirmed: number }> {
    const rows = await this.db
      .select({ total: count(), confirmed: sum(vehiclePl.confirmed) })
      .from(vehiclePl)
      .where(eq(vehiclePl.yearMonth, yearMonth));
    return {
      total: rows[0]?.total ?? 0,
      confirmed: Number(rows[0]?.confirmed ?? 0),
    };
  }

  async setConfirmed(yearMonth: string, confirmed: boolean): Promise<void> {
    await this.db
      .update(vehiclePl)
      .set({ confirmed })
      .where(eq(vehiclePl.yearMonth, yearMonth));
  }
}

function mapRow(row: typeof vehiclePl.$inferSelect): VehiclePlCalculated {
  return {
    no: row.vehicleNo,
    type: row.type,
    depot: row.depot,
    reg: row.reg,
    code: row.code,
    driver: row.driver,
    trips: row.trips,
    slips: row.slips,
    hours: row.hours,
    km: row.km,
    fare: row.fare,
    fee: row.fee,
    sales: row.sales,
    toll: row.toll,
    tollDisc: row.tollDisc,
    tollNet: row.tollNet,
    fuelIn: row.fuelIn,
    fuelInQty: row.fuelInQty,
    fuelOut: row.fuelOut,
    fuelOutQty: row.fuelOutQty,
    fuelQty: row.fuelQty,
    nempi: row.nempi,
    adblue: row.adblue,
    fuelTotal: row.fuelTotal,
    repair: row.repair,
    repairStandard: row.repairStandard,
    tire: row.tire,
    equip: row.equip,
    mainte: row.mainte,
    repairTotal: row.repairTotal,
    salary: row.salary,
    bonus: row.bonus,
    welfare: row.welfare,
    laborTotal: row.laborTotal,
    insCompulsory: row.insCompulsory,
    insVoluntary: row.insVoluntary,
    insTotal: row.insTotal,
    taxAuto: row.taxAuto,
    taxWeight: row.taxWeight,
    taxTotal: row.taxTotal,
    miscOther: row.miscOther,
    miscTotal: row.miscTotal,
    lease: row.lease,
    installment: row.installment,
    transportTotal: row.transportTotal,
    adminFee: row.adminFee,
    adminTotal: row.adminTotal,
    fixed: row.fixed,
    variable: row.variable,
    expense: row.expense,
    profit: row.profit,
    margin: row.margin,
  };
}
