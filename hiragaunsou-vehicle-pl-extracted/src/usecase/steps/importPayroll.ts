import { parsePayrollCsv } from "../../infrastructure/parsers/payrollParser";
import type { FileStorageRepository } from "../../domain/repositories/FileStorageRepository";
import type { ImportBatchRepository } from "../../domain/repositories/VehiclePlRepository";

/**
 * STEP3: 給与集計表(日給者)取込 ユースケース。
 * フロー: アップロード → R2保存(監査証跡) → パース → raw_ingestion永続化。
 * 賞与(年40万÷12)・福利厚生費は下流の連鎖計算(層②)で自動算出するため、
 * このユースケースでは総支給額・社保合計を生データとして保持するのみ(下流の値は手入力させない §2.3)。
 */
export interface ImportPayrollInput {
  yearMonth: string;
  fileName: string;
  content: ArrayBuffer | Uint8Array;
  importedBy: string | null;
}

export interface ImportPayrollResult {
  batchId: string;
  storedFileKey: string;
  totalRows: number;
}

const SOURCE_TYPE = "payroll";

export class ImportPayrollUseCase {
  constructor(
    private readonly fileStorage: FileStorageRepository,
    private readonly importBatchRepo: ImportBatchRepository,
  ) {}

  async execute(input: ImportPayrollInput): Promise<ImportPayrollResult> {
    const stored = await this.fileStorage.save(
      input.yearMonth,
      SOURCE_TYPE,
      input.fileName,
      input.content,
    );

    const records = parsePayrollCsv(input.content);

    const batchId = crypto.randomUUID();
    await this.importBatchRepo.createBatch({
      id: batchId,
      sourceType: SOURCE_TYPE,
      yearMonth: input.yearMonth,
      fileName: input.fileName,
      importedBy: input.importedBy,
      rowCount: records.length,
    });

    await this.importBatchRepo.saveRawIngestion(
      batchId,
      SOURCE_TYPE,
      input.yearMonth,
      records.map((r, i) => ({
        rowIndex: i,
        naturalKey: r.employeeCode,
        raw: r,
        flags: [] as string[],
      })),
    );

    return {
      batchId,
      storedFileKey: stored.key,
      totalRows: records.length,
    };
  }
}
