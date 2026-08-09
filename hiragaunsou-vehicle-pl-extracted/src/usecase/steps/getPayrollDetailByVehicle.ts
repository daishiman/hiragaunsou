import type { ImportBatchRepository } from "../../domain/repositories/VehiclePlRepository";
import type { VehicleMasterRepository, DriverMasterRepository } from "../../domain/repositories/MasterRepository";
import type { VehiclePlOverrideRepository } from "../../domain/repositories/VehiclePlOverrideRepository";
import type { OverridableField } from "../../domain/rules/vehiclePlOverride";
import { aggregatePayrollByVehicle } from "./finalizeMonthlyPl";

export interface PayrollDetailRow {
  vehicleNo: string;
  vehicleType: string;
  depot: string;
  driverName: string | null;
  driverCount: number;
  /** 給与集計表CSVから集計した値(取込値)。手修正しても変わらない。 */
  importedSalary: number;
  importedWelfare: number;
  /** 収支表に実際に載る値。手修正があればその値、無ければ取込値と同じ。 */
  salary: number;
  welfare: number;
  /** 手修正されているか(取込値と別の値が入っているか) */
  salaryOverridden: boolean;
  welfareOverridden: boolean;
  /**
   * その車両の直し全体。給与だけを直すときも上書きは車両単位で1レコードなので、
   * 走行距離など他の画面で入れた直しを消さないよう、そのまま持ち回して送り返す。
   */
  overrideValues: Partial<Record<OverridableField, number>>;
  overrideExcluded: boolean;
  overrideReason: string | null;
  /** 直しの最終更新時刻。保存時に渡して「先に直した人がいる」を検出する。 */
  overrideUpdatedAt: number | null;
  /**
   * 割り当てられた乗務員のうち、給与集計表に社員Noが見つかった人数。
   * driverCount より少ないとき、その差の人数ぶんの給与が0円で集計されている。
   */
  payrollMatchedCount: number;
}

/**
 * 「0円」がなぜ0円なのかの診断。金額だけを見ても、以下の3つは同じ0円として並ぶ。
 * どれが起きているかで打つ手(マスタを直す・CSVを取り込む・手で直す)が変わるため、
 * 画面が言い分けられるように数えて返す。
 */
export interface PayrollDetailSummary {
  /** 取り込んだ給与集計表の明細件数。0なら「まだCSVを取り込んでいない」 */
  payrollRowCount: number;
  /** 運転者マスタの登録件数。0なら「社員No↔車番の対応表が無い」 */
  driverMasterCount: number;
  /** 運転者マスタで車番が割り当てられている車両数。0なら全車が「未割当」になる */
  assignedVehicleCount: number;
  /** 運転者は割り当たっているのに、給与集計表に社員Noが見つからない車両数 */
  payrollMissingVehicleCount: number;
}

export interface PayrollDetailResult {
  rows: PayrollDetailRow[];
  summary: PayrollDetailSummary;
}

/**
 * 手入力画面 STEP4「人件費の確認」向け: 給与集計表(取込済み・raw_ingestion)を
 * 社員コード→運転者マスタ→車両、の連鎖で車両単位に集約した内訳を返す。
 *
 * 集約ロジック自体は収支確定(finalizeMonthlyPl.ts の aggregatePayrollByVehicle)と共通化し、
 * 「確定時に計算される金額」と「確認画面で見える金額」がずれないようにする。
 * 運転者が割り当てられていない車両も0円の行として含め、「取り漏れ」に気づけるようにする。
 *
 * 取込値に人が手を入れた分(vehicle_pl_override の salary / welfare)は、取込値とは別に返す。
 * 同じ列に混ぜて返すと「CSVがこの金額だった」のか「人が直した」のかが画面から永久に消え、
 * CSVを取り込み直したときにどちらへ戻すのが正しいのか誰にも言えなくなる。
 */
export class GetPayrollDetailByVehicleUseCase {
  constructor(
    private readonly importBatchRepo: ImportBatchRepository,
    private readonly vehicleMasterRepo: VehicleMasterRepository,
    private readonly driverMasterRepo: DriverMasterRepository,
    private readonly overrideRepo: VehiclePlOverrideRepository,
  ) {}

  async execute(yearMonth: string): Promise<PayrollDetailResult> {
    const [payrollRawRows, vehicles, drivers, overrides] = await Promise.all([
      this.importBatchRepo.findRawRows(yearMonth, "payroll"),
      this.vehicleMasterRepo.findAllActive(),
      this.driverMasterRepo.findAll(),
      this.overrideRepo.findByYearMonth(yearMonth),
    ]);

    const byVehicle = aggregatePayrollByVehicle(payrollRawRows, drivers);
    const overrideByVehicle = new Map(overrides.map((o) => [o.vehicleNo, o]));

    const rows = vehicles
      .map((vehicle) => {
        const agg = byVehicle.get(vehicle.vehicleNo);
        const override = overrideByVehicle.get(vehicle.vehicleNo);
        const importedSalary = agg?.salary ?? 0;
        const importedWelfare = agg?.welfare ?? 0;
        const overriddenSalary = override?.values.salary;
        const overriddenWelfare = override?.values.welfare;
        return {
          vehicleNo: vehicle.vehicleNo,
          vehicleType: vehicle.vehicleType,
          depot: vehicle.depot,
          driverName: agg?.driverName || null,
          driverCount: agg?.driverCount ?? 0,
          importedSalary,
          importedWelfare,
          salary: overriddenSalary ?? importedSalary,
          welfare: overriddenWelfare ?? importedWelfare,
          salaryOverridden: overriddenSalary !== undefined,
          welfareOverridden: overriddenWelfare !== undefined,
          overrideValues: override?.values ?? {},
          overrideExcluded: override?.excluded ?? false,
          overrideReason: override?.reason ?? null,
          overrideUpdatedAt: override?.updatedAt.getTime() ?? null,
          payrollMatchedCount: agg?.payrollMatchedCount ?? 0,
        };
      })
      .sort((a, b) => a.vehicleNo.localeCompare(b.vehicleNo, "ja"));

    return {
      rows,
      summary: {
        payrollRowCount: payrollRawRows.length,
        driverMasterCount: drivers.length,
        assignedVehicleCount: rows.filter((r) => r.driverName !== null).length,
        payrollMissingVehicleCount: rows.filter(
          (r) => r.driverCount > 0 && r.payrollMatchedCount < r.driverCount,
        ).length,
      },
    };
  }
}
