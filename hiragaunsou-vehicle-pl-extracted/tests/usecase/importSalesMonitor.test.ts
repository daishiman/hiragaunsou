import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ImportSalesMonitorUseCase } from "../../src/usecase/steps/importSalesMonitor";
import type { FileStorageRepository, StoredFileRef } from "../../src/domain/repositories/FileStorageRepository";
import type { ImportBatchRepository } from "../../src/domain/repositories/VehiclePlRepository";

const fixture = readFileSync(resolve(__dirname, "../fixtures/sales_monitor_sample.csv"));

function stubFileStorage() {
  const calls: { yearMonth: string; fileType: string; originalFileName: string }[] = [];
  const repo: FileStorageRepository = {
    save: async (yearMonth, fileType, originalFileName): Promise<StoredFileRef> => {
      calls.push({ yearMonth, fileType, originalFileName });
      return {
        key: `imports/${yearMonth}/${fileType}/1700000000000_${originalFileName}`,
        size: 0,
        storedAt: 1700000000000,
      };
    },
    get: async () => null,
  };
  return { repo, calls };
}

function stubImportBatchRepo() {
  const calls: {
    createBatch: Parameters<ImportBatchRepository["createBatch"]>[0][];
    saveRawIngestion: { batchId: string; sourceType: string; yearMonth: string; rows: Parameters<ImportBatchRepository["saveRawIngestion"]>[3] }[];
  } = { createBatch: [], saveRawIngestion: [] };
  const repo: ImportBatchRepository = {
    createBatch: async (input) => {
      calls.createBatch.push(input);
    },
    saveRawIngestion: async (batchId, sourceType, yearMonth, rows) => {
      calls.saveRawIngestion.push({ batchId, sourceType, yearMonth, rows });
    },
  };
  return { repo, calls };
}

describe("ImportSalesMonitorUseCase", () => {
  it("R2保存後にパースし、傭車を除外・諸口行は要確認フラグ付きでraw_ingestionに保存する", async () => {
    const { repo: fileStorage, calls: storageCalls } = stubFileStorage();
    const { repo: importBatchRepo, calls: batchCalls } = stubImportBatchRepo();
    const useCase = new ImportSalesMonitorUseCase(fileStorage, importBatchRepo);

    const result = await useCase.execute({
      yearMonth: "2026-05",
      fileName: "sales_monitor.csv",
      content: new Uint8Array(fixture),
      importedBy: "user-1",
    });

    expect(storageCalls).toHaveLength(1);
    expect(storageCalls[0]).toMatchObject({
      yearMonth: "2026-05",
      fileType: "sales_monitor",
      originalFileName: "sales_monitor.csv",
    });
    expect(result.storedFileKey).toContain("imports/2026-05/sales_monitor/");
    expect(result.totalRows).toBeGreaterThan(0);
    expect(result.charteredExcluded).toBeGreaterThan(0);
    expect(result.needsReviewCount).toBeGreaterThan(0);

    expect(batchCalls.createBatch).toHaveLength(1);
    expect(batchCalls.createBatch[0]).toMatchObject({
      id: result.batchId,
      sourceType: "sales_monitor",
      yearMonth: "2026-05",
      fileName: "sales_monitor.csv",
      importedBy: "user-1",
    });

    expect(batchCalls.saveRawIngestion).toHaveLength(1);
    const ingestion = batchCalls.saveRawIngestion[0];
    // 傭車(88888)は保存対象から除外されている
    expect(ingestion.rows.every((r) => r.naturalKey !== "88888")).toBe(true);
    // 諸口行はflagsに要確認マークが付いたまま残る(自動削除しない)
    const misc = ingestion.rows.find((r) => r.flags.includes("misc_entry"));
    expect(misc).toBeDefined();
  });
});
