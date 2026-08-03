import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ImportPayrollUseCase } from "../../src/usecase/steps/importPayroll";
import type { FileStorageRepository, StoredFileRef } from "../../src/domain/repositories/FileStorageRepository";
import type { ImportBatchRepository } from "../../src/domain/repositories/VehiclePlRepository";

const fixture = readFileSync(resolve(__dirname, "../fixtures/payroll_sample.csv"));

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

describe("ImportPayrollUseCase", () => {
  it("R2保存後にパースし、社員No毎の給与レコードをraw_ingestionに保存する", async () => {
    const { repo: fileStorage, calls: storageCalls } = stubFileStorage();
    const { repo: importBatchRepo, calls: batchCalls } = stubImportBatchRepo();
    const useCase = new ImportPayrollUseCase(fileStorage, importBatchRepo);

    const result = await useCase.execute({
      yearMonth: "2026-05",
      fileName: "payroll.csv",
      content: new Uint8Array(fixture),
      importedBy: "user-1",
    });

    expect(storageCalls).toHaveLength(1);
    expect(storageCalls[0]).toMatchObject({
      yearMonth: "2026-05",
      fileType: "payroll",
      originalFileName: "payroll.csv",
    });
    expect(result.storedFileKey).toContain("imports/2026-05/payroll/");
    expect(result.totalRows).toBeGreaterThan(0);

    expect(batchCalls.createBatch).toHaveLength(1);
    expect(batchCalls.createBatch[0]).toMatchObject({
      id: result.batchId,
      sourceType: "payroll",
      yearMonth: "2026-05",
      fileName: "payroll.csv",
      importedBy: "user-1",
      rowCount: result.totalRows,
    });

    expect(batchCalls.saveRawIngestion).toHaveLength(1);
    const ingestion = batchCalls.saveRawIngestion[0];
    expect(ingestion.rows[0]?.naturalKey).toBe("93");
    expect(ingestion.rows.every((r) => r.naturalKey !== "")).toBe(true);
  });
});
