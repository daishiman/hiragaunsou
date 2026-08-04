import { parseSalesMonitorCsv } from "../../infrastructure/parsers/salesMonitorParser";
import { isCharteredVehicle } from "../../domain/rules/charteredVehicle";
import { detectCleansingFlags, needsHumanDecision } from "../../domain/rules/cleansingRules";
import type { FileStorageRepository } from "../../domain/repositories/FileStorageRepository";
import type { ImportBatchRepository } from "../../domain/repositories/VehiclePlRepository";

/**
 * STEP2: 売上モニタリスト(車楽クラウド)取込 ユースケース。
 * フロー: アップロード → R2保存(監査証跡) → パース → 傭車除外 → raw_ingestion永続化。
 * 「諸口」行は自動削除せず、要確認フラグ(flags)を付けたまま raw_ingestion に残す。
 */
export interface ImportSalesMonitorInput {
  yearMonth: string;
  fileName: string;
  content: ArrayBuffer | Uint8Array;
  importedBy: string | null;
}

export interface ImportSalesMonitorResult {
  batchId: string;
  storedFileKey: string;
  totalRows: number;
  charteredExcluded: number;
  needsReviewCount: number;
}

const SOURCE_TYPE = "sales_monitor";

export class ImportSalesMonitorUseCase {
  constructor(
    private readonly fileStorage: FileStorageRepository,
    private readonly importBatchRepo: ImportBatchRepository,
  ) {}

  async execute(input: ImportSalesMonitorInput): Promise<ImportSalesMonitorResult> {
    const stored = await this.fileStorage.save(
      input.yearMonth,
      SOURCE_TYPE,
      input.fileName,
      input.content,
    );

    const records = parseSalesMonitorCsv(input.content);

    const charteredExcluded = records.filter((r) => isCharteredVehicle(r.vehicleCode)).length;
    const kept = records.filter((r) => !isCharteredVehicle(r.vehicleCode));

    // STEP2のデータ整形フラグ(2重計上の疑い・諸口)は取込時に確定させ、raw_ingestion に貼っておく。
    // こうしておくと「要確認が何件あるか」を生データを読み直さずに数えられる(ホームの進捗表示が軽くなる)。
    const flagsPerRow = kept.map((r) =>
      detectCleansingFlags({ vehicleNo: r.vehicleCode, driverName: r.driverName }),
    );
    const needsReviewCount = flagsPerRow.filter(needsHumanDecision).length;

    const batchId = crypto.randomUUID();
    await this.importBatchRepo.createBatch({
      id: batchId,
      sourceType: SOURCE_TYPE,
      yearMonth: input.yearMonth,
      fileName: input.fileName,
      importedBy: input.importedBy,
      rowCount: kept.length,
      excludedRowCount: charteredExcluded,
    });

    await this.importBatchRepo.saveRawIngestion(
      batchId,
      SOURCE_TYPE,
      input.yearMonth,
      kept.map((r, i) => ({
        rowIndex: i,
        naturalKey: r.vehicleCode,
        raw: r,
        flags: (flagsPerRow[i] ?? []).map((f) => f.type),
      })),
    );

    return {
      batchId,
      storedFileKey: stored.key,
      totalRows: records.length,
      charteredExcluded,
      needsReviewCount,
    };
  }
}
