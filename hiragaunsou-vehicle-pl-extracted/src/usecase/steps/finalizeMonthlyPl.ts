import { aggregateSalesByVehicle, type SalesMonitorRow } from "../../infrastructure/parsers/salesMonitorParser";
import type { VehicleOperationRecord } from "../../infrastructure/parsers/vehicleOperationParser";
import type { PayrollRecord } from "../../infrastructure/parsers/payrollParser";
import { calculateVehiclePl, type VehiclePlCalculated, type VehiclePlInput } from "../../domain/rules/vehiclePlCalculation";
import { STANDARD_COST_RATES } from "../../domain/entities/VehiclePl";
import type { ImportBatchRepository, VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type {
  VehicleMasterRepository,
  DriverMasterRepository,
  RateMasterRepository,
} from "../../domain/repositories/MasterRepository";
import type { CleansingDecisionRecord } from "../../domain/repositories/CleansingDecisionRepository";
import { applyCleansingDecisions } from "./getCleansingQueue";
import type { DriverMasterRecord } from "../../domain/repositories/MasterRepository";

/** 車両1台分の給与集計(社員コード→運転者マスタ→車両の連鎖の結果)。 */
export interface VehiclePayrollAggregate {
  vehicleNo: string;
  /** 2人乗務等で複数名いる場合は "/" 区切り */
  driverName: string;
  /** 総支給額(複数名の場合は合算) */
  salary: number;
  /** 社保合計額(複数名の場合は合算) */
  welfare: number;
  /** 乗務員数(賞与は1人あたりの支給額のため、2人乗務車両は2人分になる) */
  driverCount: number;
}

/**
 * 社員コード→運転者マスタ→車両、の連鎖で給与集計表(raw_ingestion)を車両単位に集約する。
 * STEP7の収支確定(このファイル内)と、STEP3「人件費の確認」画面の車両別内訳表示
 * (getPayrollDetailByVehicle.ts)の両方から呼ばれる共通ロジック。
 * 二重実装すると突合ロジックがずれる恐れがあるため、ここに一本化する。
 */
export function aggregatePayrollByVehicle(
  payrollRawRows: readonly { naturalKey: string | null; raw: unknown }[],
  drivers: readonly DriverMasterRecord[],
): Map<string, VehiclePayrollAggregate> {
  const payrollByEmployee = new Map<string, PayrollRecord>();
  for (const r of payrollRawRows) {
    if (r.naturalKey) payrollByEmployee.set(r.naturalKey, r.raw as PayrollRecord);
  }

  const result = new Map<string, VehiclePayrollAggregate>();
  for (const driver of drivers) {
    if (!driver.vehicleNo) continue;
    const payroll = payrollByEmployee.get(driver.employeeCode);
    const existing = result.get(driver.vehicleNo) ?? {
      vehicleNo: driver.vehicleNo,
      driverName: "",
      salary: 0,
      welfare: 0,
      driverCount: 0,
    };
    result.set(driver.vehicleNo, {
      vehicleNo: driver.vehicleNo,
      driverName: existing.driverName ? `${existing.driverName}/${driver.driverName}` : driver.driverName,
      salary: existing.salary + (payroll?.totalPay ?? 0),
      welfare: existing.welfare + (payroll?.socialInsuranceTotal ?? 0),
      driverCount: existing.driverCount + 1,
    });
  }
  return result;
}

/**
 * STEP7: 収支確定(締め)ユースケース。
 *
 * 要件定義§2.3の連鎖反映ルールに従い、車両マスタを起点に
 * STEP1-3で取り込んだraw_ingestion(運行実績/売上/給与)とレートマスタを突合し、
 * calculateVehiclePl で下流の固定費/変動費/損益を再計算してから永続化する。
 * 「下流の値は絶対に手入力させない」原則に対応し、上流データが揃っている限り
 * このユースケースが再計算の唯一の入口になる。
 *
 * 燃料(インタンク/外部給油量・アドブルー)・修理実費・備品・メンテ・その他諸経費は
 * 層③(人間入力)の値としてこのユースケースの引数で受け取る
 * (要件定義§2.2: 燃料は「1次ソース接続が最大の棚卸し対象。取れなければ車両×金額の一括貼付UI」)。
 */
export interface ManualVehicleInput {
  vehicleNo: string;
  /** STEP3 燃料費 */
  fuelInQty: number;
  fuelOut: number;
  fuelOutQty: number;
  adblue: number;
  /** STEP5 経費(修繕費・タイヤ) */
  repairActual: number;
  /** タイヤ実費。未入力(null)なら km×単価の標準原価にフォールバックする */
  tireActual?: number | null;
  equip: number;
  mainte: number;
  /** STEP6 高速料金。未入力(null)なら売上モニタリスト由来の通行料/組合割引率で近似する */
  tollActual?: number | null;
  tollDiscountActual?: number | null;
  miscOther: number;
}

export interface FinalizeMonthlyPlInput {
  yearMonth: string;
  manualInputs: ManualVehicleInput[];
  /**
   * STEP2: キリンの輸送協力金・経営支援金の配賦結果 (車番 → 加算額)。
   * 現行Excelは配賦額を収支表 L列「高速他料金」(=売上側) に載せているため、
   * 附帯料金に加算する (置き換えない)。費用側の諸経費ではない。
   */
  kirinAllocations?: readonly { vehicleNo: string; amount: number }[];
  /**
   * STEP2: データ整形で人が下した判断 (除外する/車番を修正して残す)。
   * 元データは書き換えず、集計の直前にここで重ねる。
   */
  cleansingDecisions?: readonly CleansingDecisionRecord[];
}

export interface FinalizeMonthlyPlResult {
  yearMonth: string;
  vehicleCount: number;
  rows: VehiclePlCalculated[];
}

const ZERO_MANUAL_INPUT: Omit<ManualVehicleInput, "vehicleNo"> = {
  fuelInQty: 0,
  fuelOut: 0,
  fuelOutQty: 0,
  adblue: 0,
  repairActual: 0,
  tireActual: null,
  equip: 0,
  mainte: 0,
  tollActual: null,
  tollDiscountActual: null,
  miscOther: 0,
};

export class FinalizeMonthlyPlUseCase {
  constructor(
    private readonly importBatchRepo: ImportBatchRepository,
    private readonly vehicleMasterRepo: VehicleMasterRepository,
    private readonly driverMasterRepo: DriverMasterRepository,
    private readonly rateMasterRepo: RateMasterRepository,
    private readonly vehiclePlRepo: VehiclePlRepository,
  ) {}

  async execute(input: FinalizeMonthlyPlInput): Promise<FinalizeMonthlyPlResult> {
    const [opRawRows, salesRawRows, payrollRawRows, vehicles, drivers, rates] = await Promise.all([
      this.importBatchRepo.findRawRows(input.yearMonth, "vehicle_operation"),
      this.importBatchRepo.findRawRows(input.yearMonth, "sales_monitor"),
      this.importBatchRepo.findRawRows(input.yearMonth, "payroll"),
      this.vehicleMasterRepo.findAllActive(),
      this.driverMasterRepo.findAll(),
      this.rateMasterRepo.getRates(input.yearMonth),
    ]);

    const opByVehicle = new Map<string, VehicleOperationRecord>();
    for (const r of opRawRows) {
      if (r.naturalKey) opByVehicle.set(r.naturalKey, r.raw as VehicleOperationRecord);
    }

    // STEP2のデータ整形の判断を先に重ねてから集計する
    const salesRows = applyCleansingDecisions(
      salesRawRows.map((r) => r.raw as SalesMonitorRow),
      input.cleansingDecisions ?? [],
    );
    const salesAgg = aggregateSalesByVehicle(salesRows);

    const driversByVehicle = aggregatePayrollByVehicle(payrollRawRows, drivers);

    const manualByVehicle = new Map<string, ManualVehicleInput>();
    for (const m of input.manualInputs) {
      manualByVehicle.set(m.vehicleNo, m);
    }

    // STEP2: キリン配賦は売上(高速他料金)への加算。集計済みの値を消さずに足す。
    const kirinByVehicle = new Map<string, number>();
    for (const a of input.kirinAllocations ?? []) {
      kirinByVehicle.set(a.vehicleNo, (kirinByVehicle.get(a.vehicleNo) ?? 0) + a.amount);
    }

    const rows: VehiclePlCalculated[] = vehicles.map((vehicle) => {
      const op = opByVehicle.get(vehicle.vehicleNo);
      const sales = salesAgg.get(vehicle.vehicleNo);
      const driver = driversByVehicle.get(vehicle.vehicleNo);
      const manual = manualByVehicle.get(vehicle.vehicleNo) ?? {
        vehicleNo: vehicle.vehicleNo,
        ...ZERO_MANUAL_INPUT,
      };
      const standardCostRate =
        STANDARD_COST_RATES[vehicle.costCategory] ?? STANDARD_COST_RATES["medium"]!;

      const plInput: VehiclePlInput = {
        no: vehicle.vehicleNo,
        type: vehicle.vehicleType,
        depot: vehicle.depot,
        reg: vehicle.regDate,
        code: null,
        driver: driver?.driverName ?? null,
        trips: op?.tripCount ?? 0,
        slips: sales?.slipCount ?? 0,
        hours: op?.operatingHours ?? 0,
        km: op?.totalDistanceKm ?? 0,
        fare: sales?.fare ?? 0,
        fee: (sales?.ancillaryFee ?? 0) + (kirinByVehicle.get(vehicle.vehicleNo) ?? 0),
        toll: sales?.toll ?? 0,
        fuelInQty: manual.fuelInQty,
        fuelOutQty: manual.fuelOutQty,
        fuelOut: manual.fuelOut,
        adblue: manual.adblue,
        repairActual: manual.repairActual,
        tireActual: manual.tireActual ?? null,
        tollActual: manual.tollActual ?? null,
        tollDiscountActual: manual.tollDiscountActual ?? null,
        equip: manual.equip,
        mainte: manual.mainte,
        salary: driver?.salary ?? 0,
        welfare: driver?.welfare ?? 0,
        insCompulsory: vehicle.insCompulsory,
        insVoluntary: vehicle.insVoluntary,
        taxAuto: vehicle.taxAuto,
        taxWeight: vehicle.taxWeight,
        miscOther: manual.miscOther,
        driverCount: driver?.driverCount ?? 0,
        lease: vehicle.lease,
        installment: vehicle.installment,
        standardCostRate,
      };

      return calculateVehiclePl(plInput, rates);
    });

    await this.vehiclePlRepo.upsertMany(input.yearMonth, rows);

    return { yearMonth: input.yearMonth, vehicleCount: rows.length, rows };
  }
}
