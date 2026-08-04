import { describe, expect, it } from "vitest";
import { ImportMonthlyPlWorkbookUseCase } from "../../src/usecase/steps/importMonthlyPlWorkbook";
import type { FileStorageRepository, StoredFileRef } from "../../src/domain/repositories/FileStorageRepository";
import type { ImportBatchRepository, VehiclePlRepository } from "../../src/domain/repositories/VehiclePlRepository";
import { buildMonthlyPlWorkbookFixture } from "../fixtures/monthlyPlWorkbook";

describe("ImportMonthlyPlWorkbookUseCase", () => {
  it("完成済みExcelを原本保存し、88888だけ除外してD1用の一覧表・要確認根拠を作る", async () => {
    const storageCalls: unknown[] = [];
    const rawCalls: Parameters<ImportBatchRepository["saveRawIngestion"]>[3][] = [];
    const upsertCalls: unknown[] = [];
    const fileStorage: FileStorageRepository = {
      save: async (_yearMonth, _fileType, fileName): Promise<StoredFileRef> => {
        storageCalls.push({ fileName });
        return { key: "imports/2026-05/monthly_pl_workbook/sample.xlsx", size: 1, storedAt: 1 };
      },
      get: async () => null,
    };
    const batchRepo: ImportBatchRepository = {
      createBatch: async () => undefined,
      saveRawIngestion: async (_batchId, _sourceType, _yearMonth, rows) => { rawCalls.push(rows); },
      findRawRows: async () => [],
      findLatestBatch: async () => null,
    };
    const vehiclePlRepo: VehiclePlRepository = {
      upsertMany: async (_yearMonth, rows) => { upsertCalls.push(rows); },
      findByYearMonth: async () => [],
      findByVehicleNo: async () => [],
      findByYearMonths: async () => new Map(),
      countByYearMonth: async () => 0,
    };

    const result = await new ImportMonthlyPlWorkbookUseCase(fileStorage, batchRepo, vehiclePlRepo).execute({
      yearMonth: "2026-05",
      fileName: "名称が変わる収支表.xlsx",
      content: buildMonthlyPlWorkbookFixture(),
      importedBy: "user-1",
    });

    expect(storageCalls).toHaveLength(1);
    expect(result).toMatchObject({ totalRows: 2, vehicleCount: 1, charteredExcluded: 1, needsReviewCount: 1 });
    expect(rawCalls[0]).toHaveLength(1);
    expect(rawCalls[0]?.[0]?.flags).toEqual(["misc_driver_name", "duplicate_review_candidate"]);
    expect(upsertCalls[0]).toHaveLength(1);
  });
});
