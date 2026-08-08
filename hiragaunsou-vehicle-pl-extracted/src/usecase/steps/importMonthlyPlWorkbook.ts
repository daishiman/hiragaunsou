import { isCharteredVehicle } from "../../domain/rules/charteredVehicle";
import type { FileStorageRepository } from "../../domain/repositories/FileStorageRepository";
import type { ImportBatchRepository } from "../../domain/repositories/VehiclePlRepository";
import { parseMonthlyPlWorkbook } from "../../infrastructure/parsers/monthlyPlWorkbookParser";

/** 完成済み「○月収支表」Excel。答え合わせの相手として取り込むだけの参照データ。 */
export const MONTHLY_PL_WORKBOOK_SOURCE_TYPE = "monthly_pl_workbook";

export interface ImportMonthlyPlWorkbookInput {
  yearMonth: string;
  fileName: string;
  content: ArrayBuffer | Uint8Array;
  importedBy: string | null;
  /** 監査ログに残す実行者の表示名。未指定ならIDで代替する。 */
  importedByName?: string | null;
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
 * 完成済みExcelを「答え合わせの相手」として取り込むユースケース。
 *
 * 収支表そのものは、業務フローどおり
 *   運行実績CSV / 売上モニタリストCSV / 給与集計表CSV / 車両マスタ / 運転者マスタ / 手入力
 * だけから作られる。このExcelはその入力ではない。
 *
 * かつてこのユースケースはExcelの完成値を vehicle_pl へ直接書き、さらに車両マスタまで
 * 上書きしていた。その結果、CSVの紐付けが1つも通っていなくても表は完成してしまい、
 * 「CSVから作られた表」と「Excelを写しただけの表」が画面上で区別できなかった
 * (実際、本番の2026年5月のデータはExcelを写したものだった)。
 *
 * そのため現在は raw_ingestion に原文を残すだけに徹し、計算に効くものは何も書かない。
 * 取り込んだ値は GetExcelReconciliationUseCase が車番別の突合表に使う。
 * ここに書き込み先を足すと、また「Excelで表が完成してしまう」状態に戻るので足さないこと。
 */
export class ImportMonthlyPlWorkbookUseCase {
  constructor(
    private readonly fileStorage: FileStorageRepository,
    private readonly importBatchRepo: ImportBatchRepository,
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
