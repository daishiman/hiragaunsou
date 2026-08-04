import { isCharteredVehicle } from "../../domain/rules/charteredVehicle";
import type { FileStorageRepository } from "../../domain/repositories/FileStorageRepository";
import type { ImportBatchRepository, VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import { parseMonthlyPlWorkbook } from "../../infrastructure/parsers/monthlyPlWorkbookParser";

/** 既存Excelの完成済み「○月収支表」を、移行期間の正本データとして取り込む種別。 */
export const MONTHLY_PL_WORKBOOK_SOURCE_TYPE = "monthly_pl_workbook";

export interface ImportMonthlyPlWorkbookInput {
  yearMonth: string;
  fileName: string;
  content: ArrayBuffer | Uint8Array;
  importedBy: string | null;
}

export interface ImportMonthlyPlWorkbookResult {
  batchId: string;
  storedFileKey: string;
  sourceSheet: string;
  totalRows: number;
  vehicleCount: number;
  charteredExcluded: number;
  needsReviewCount: number;
}

/**
 * STEP 7〜8の既存成果物をD1に移すユースケース。
 * CSV/PDF取込の完全自動化へ移行する間も、毎月の完成表をWebで閲覧・比較できるようにする。
 * 「88888」だけは確定ルールなので除外し、諸口・過去実績のある重複候補は消さずに要確認として残す。
 */
export class ImportMonthlyPlWorkbookUseCase {
  constructor(
    private readonly fileStorage: FileStorageRepository,
    private readonly importBatchRepo: ImportBatchRepository,
    private readonly vehiclePlRepo: VehiclePlRepository,
  ) {}

  async execute(input: ImportMonthlyPlWorkbookInput): Promise<ImportMonthlyPlWorkbookResult> {
    const stored = await this.fileStorage.save(
      input.yearMonth,
      MONTHLY_PL_WORKBOOK_SOURCE_TYPE,
      input.fileName,
      input.content,
    );
    const parsed = parseMonthlyPlWorkbook(input.content, input.yearMonth);
    const charteredExcluded = parsed.rows.filter((row) => isCharteredVehicle(row.no)).length;
    const kept = parsed.rows.filter((row) => !isCharteredVehicle(row.no));
    const batchId = crypto.randomUUID();
    const rawRows = kept.map((row, rowIndex) => ({
      rowIndex,
      naturalKey: row.no,
      raw: row,
      flags: reviewFlags(row.no, row.driver),
    }));

    await this.importBatchRepo.createBatch({
      id: batchId,
      sourceType: MONTHLY_PL_WORKBOOK_SOURCE_TYPE,
      yearMonth: input.yearMonth,
      fileName: input.fileName,
      importedBy: input.importedBy,
      rowCount: kept.length,
    });
    await this.importBatchRepo.saveRawIngestion(
      batchId,
      MONTHLY_PL_WORKBOOK_SOURCE_TYPE,
      input.yearMonth,
      rawRows,
    );
    await this.vehiclePlRepo.upsertMany(input.yearMonth, kept);

    return {
      batchId,
      storedFileKey: stored.key,
      sourceSheet: parsed.sheetName,
      totalRows: parsed.rows.length,
      vehicleCount: kept.length,
      charteredExcluded,
      needsReviewCount: rawRows.filter((row) => row.flags.length > 0).length,
    };
  }
}

function reviewFlags(vehicleNo: string, driver: string | null): string[] {
  const flags: string[] = [];
  if (driver?.includes("諸口")) flags.push("misc_driver_name");
  // 過去に二重計上の実績がある車番。自動削除ではなく、請求担当への確認対象として残す。
  if (["10", "888", "5000"].includes(vehicleNo)) flags.push("duplicate_review_candidate");
  return flags;
}
