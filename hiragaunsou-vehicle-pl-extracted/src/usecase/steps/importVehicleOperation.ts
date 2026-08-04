import { parseVehicleOperationCsv } from "../../infrastructure/parsers/vehicleOperationParser";
import { isCharteredVehicle } from "../../domain/rules/charteredVehicle";
import type { FileStorageRepository } from "../../domain/repositories/FileStorageRepository";
import type { ImportBatchRepository } from "../../domain/repositories/VehiclePlRepository";

/**
 * STEP1: 車両別運行実績表(デジタコ)取込 ユースケース。
 * フロー: アップロード → R2保存(監査証跡) → パース → 傭車除外 → raw_ingestion永続化。
 * UseCase層はインターフェース(FileStorageRepository / ImportBatchRepository)越しにのみ外部接続する。
 */
export interface ImportVehicleOperationInput {
  yearMonth: string;
  fileName: string;
  content: ArrayBuffer | Uint8Array;
  importedBy: string | null;
}

export interface ImportVehicleOperationResult {
  batchId: string;
  storedFileKey: string;
  totalRows: number;
  charteredExcluded: number;
}

const SOURCE_TYPE = "vehicle_operation";

export class ImportVehicleOperationUseCase {
  constructor(
    private readonly fileStorage: FileStorageRepository,
    private readonly importBatchRepo: ImportBatchRepository,
  ) {}

  async execute(input: ImportVehicleOperationInput): Promise<ImportVehicleOperationResult> {
    // 1. R2へ元ファイルを保存(パース前。監査証跡)
    const stored = await this.fileStorage.save(
      input.yearMonth,
      SOURCE_TYPE,
      input.fileName,
      input.content,
    );

    // 2. パース
    const records = parseVehicleOperationCsv(input.content);

    // 3. 傭車(車番88888)除外は自動流入時点で機械的に行ってよい(要件定義で確定済み)
    const charteredExcluded = records.filter((r) => isCharteredVehicle(r.vehicleCode)).length;
    const kept = records.filter((r) => !isCharteredVehicle(r.vehicleCode));

    // 4. バッチ・raw_ingestionの永続化(監査可能な生データ保持)
    const batchId = crypto.randomUUID();
    await this.importBatchRepo.createBatch({
      id: batchId,
      sourceType: SOURCE_TYPE,
      yearMonth: input.yearMonth,
      fileName: input.fileName,
      importedBy: input.importedBy,
      rowCount: kept.length,
    });

    await this.importBatchRepo.saveRawIngestion(
      batchId,
      SOURCE_TYPE,
      input.yearMonth,
      kept.map((r, i) => ({
        rowIndex: i,
        naturalKey: r.vehicleCode,
        raw: r,
        flags: [] as string[],
      })),
    );

    return {
      batchId,
      storedFileKey: stored.key,
      totalRows: records.length,
      charteredExcluded,
    };
  }
}
