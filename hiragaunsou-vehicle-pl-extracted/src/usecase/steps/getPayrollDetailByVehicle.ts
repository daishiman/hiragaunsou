import type { ImportBatchRepository } from "../../domain/repositories/VehiclePlRepository";
import type { VehicleMasterRepository, DriverMasterRepository } from "../../domain/repositories/MasterRepository";
import { aggregatePayrollByVehicle } from "./finalizeMonthlyPl";

export interface PayrollDetailRow {
  vehicleNo: string;
  vehicleType: string;
  depot: string;
  driverName: string | null;
  driverCount: number;
  salary: number;
  welfare: number;
}

/**
 * 手入力画面 STEP「人件費の確認」向け: 給与集計表(取込済み・raw_ingestion)を
 * 社員コード→運転者マスタ→車両、の連鎖で車両単位に集約した内訳を返す(閲覧用)。
 *
 * 集約ロジック自体は収支確定(finalizeMonthlyPl.ts の aggregatePayrollByVehicle)と共通化し、
 * 「確定時に計算される金額」と「確認画面で見える金額」がずれないようにする。
 * 運転者が割り当てられていない車両も0円の行として含め、「取り漏れ」に気づけるようにする。
 */
export class GetPayrollDetailByVehicleUseCase {
  constructor(
    private readonly importBatchRepo: ImportBatchRepository,
    private readonly vehicleMasterRepo: VehicleMasterRepository,
    private readonly driverMasterRepo: DriverMasterRepository,
  ) {}

  async execute(yearMonth: string): Promise<PayrollDetailRow[]> {
    const [payrollRawRows, vehicles, drivers] = await Promise.all([
      this.importBatchRepo.findRawRows(yearMonth, "payroll"),
      this.vehicleMasterRepo.findAllActive(),
      this.driverMasterRepo.findAll(),
    ]);

    const byVehicle = aggregatePayrollByVehicle(payrollRawRows, drivers);

    return vehicles
      .map((vehicle) => {
        const agg = byVehicle.get(vehicle.vehicleNo);
        return {
          vehicleNo: vehicle.vehicleNo,
          vehicleType: vehicle.vehicleType,
          depot: vehicle.depot,
          driverName: agg?.driverName || null,
          driverCount: agg?.driverCount ?? 0,
          salary: agg?.salary ?? 0,
          welfare: agg?.welfare ?? 0,
        };
      })
      .sort((a, b) => a.vehicleNo.localeCompare(b.vehicleNo, "ja"));
  }
}
