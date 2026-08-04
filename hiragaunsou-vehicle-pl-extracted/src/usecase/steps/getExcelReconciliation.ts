import type { ImportBatchRepository, VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";
import { reconcileWithExcel, type ExcelReconcileResult } from "../../domain/rules/excelReconciliation";
import { MONTHLY_PL_WORKBOOK_SOURCE_TYPE } from "./importMonthlyPlWorkbook";

/**
 * 完成済みExcelとの車番別突合 (月次収支表の下に出す一覧)。
 *
 * Excel側の値は取込時に raw_ingestion へ原文のまま残っているので、
 * 突合専用のテーブルも取込導線も増やさずに、その原文と vehicle_pl を突き合わせる。
 */
export class GetExcelReconciliationUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly importBatchRepo: ImportBatchRepository,
  ) {}

  async execute(yearMonth: string): Promise<ExcelReconcileResult> {
    const [rawRows, systemRows] = await Promise.all([
      this.importBatchRepo.findRawRows(yearMonth, MONTHLY_PL_WORKBOOK_SOURCE_TYPE),
      this.vehiclePlRepo.findByYearMonth(yearMonth),
    ]);
    const excelRows = rawRows
      .map((r) => r.raw as VehiclePlCalculated)
      .filter((r) => typeof r?.no === "string" && r.no !== "");
    return reconcileWithExcel(excelRows, systemRows);
  }
}
