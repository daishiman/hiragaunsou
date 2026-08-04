import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { vehiclePl } from "./schema";
import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";

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
          set: {
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
          },
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
