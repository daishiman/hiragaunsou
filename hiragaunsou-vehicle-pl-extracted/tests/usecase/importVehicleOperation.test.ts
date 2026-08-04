import { describe, expect, it } from "vitest";
import Encoding from "encoding-japanese";
import {
  ImportVehicleOperationUseCase,
  type ImportVehicleOperationInput,
} from "../../src/usecase/steps/importVehicleOperation";
import type { FileStorageRepository, StoredFileRef } from "../../src/domain/repositories/FileStorageRepository";
import type { ImportBatchRepository } from "../../src/domain/repositories/VehiclePlRepository";

const CSV_TEXT = [
  '"車両番号","車両名称","所属名称","車種","稼動回数","稼動時間","総距離","総給油量（L）","燃費（km/L）"',
  '"00001111","V1","D1","T1","20","174:59","6617.98","100.00","10.0"',
  '"88888","V2","D2","T2","5","10:00","100.00","10.00","10.0"',
].join("\n");

// parseVehicleOperationCsv は Uint8Array を cp932 として decode するため、
// テストのCSV文字列も encoding-japanese で cp932 バイト列にエンコードしてから渡す
function encodeCp932(text: string): Uint8Array {
  const sjisArray = Encoding.convert(Encoding.stringToCode(text), { to: "SJIS", from: "UNICODE" });
  return new Uint8Array(sjisArray);
}

function stubFileStorage(): { repo: FileStorageRepository; calls: unknown[] } {
  const calls: unknown[] = [];
  const repo: FileStorageRepository = {
    save: async (yearMonth, fileType, originalFileName, content) => {
      calls.push({ yearMonth, fileType, originalFileName, content });
      const ref: StoredFileRef = {
        key: `imports/${yearMonth}/${fileType}/1700000000000_${originalFileName}`,
        size: content instanceof Uint8Array ? content.byteLength : (content as ArrayBuffer).byteLength,
        storedAt: 1700000000000,
      };
      return ref;
    },
    get: async () => null,
  };
  return { repo, calls };
}

function stubImportBatchRepo(): { repo: ImportBatchRepository; calls: { createBatch: unknown[]; saveRawIngestion: unknown[] } } {
  const calls = { createBatch: [] as unknown[], saveRawIngestion: [] as unknown[] };
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

function buildInput(): ImportVehicleOperationInput {
  return {
    yearMonth: "2026-05",
    fileName: "vehicle_operation.csv",
    content: encodeCp932(CSV_TEXT),
    importedBy: "user-1",
  };
}

describe("ImportVehicleOperationUseCase", () => {
  it("R2保存後にパースし、傭車(車番88888)を除外してバッチ・生データを永続化する", async () => {
    const { repo: fileStorage, calls: storageCalls } = stubFileStorage();
    const { repo: importBatchRepo, calls: batchCalls } = stubImportBatchRepo();
    const useCase = new ImportVehicleOperationUseCase(fileStorage, importBatchRepo);

    const result = await useCase.execute(buildInput());

    expect(storageCalls).toHaveLength(1);
    expect(storageCalls[0]).toMatchObject({
      yearMonth: "2026-05",
      fileType: "vehicle_operation",
      originalFileName: "vehicle_operation.csv",
    });

    expect(result.totalRows).toBe(2);
    expect(result.charteredExcluded).toBe(1);
    expect(result.storedFileKey).toContain("imports/2026-05/vehicle_operation/");

    expect(batchCalls.createBatch).toHaveLength(1);
    expect(batchCalls.createBatch[0]).toMatchObject({
      id: result.batchId,
      sourceType: "vehicle_operation",
      yearMonth: "2026-05",
      fileName: "vehicle_operation.csv",
      importedBy: "user-1",
      rowCount: 1,
    });

    expect(batchCalls.saveRawIngestion).toHaveLength(1);
    const ingestion = batchCalls.saveRawIngestion[0] as {
      batchId: string;
      sourceType: string;
      yearMonth: string;
      rows: { rowIndex: number; naturalKey: string | null; raw: unknown; flags: string[] }[];
    };
    expect(ingestion.rows).toHaveLength(1);
    expect(ingestion.rows[0]?.naturalKey).toBe("1111");
  });
});
