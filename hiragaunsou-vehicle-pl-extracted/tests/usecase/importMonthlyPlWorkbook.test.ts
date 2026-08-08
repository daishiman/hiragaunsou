import { describe, expect, it, vi } from "vitest";
import { ImportMonthlyPlWorkbookUseCase } from "../../src/usecase/steps/importMonthlyPlWorkbook";
import type { FileStorageRepository, StoredFileRef } from "../../src/domain/repositories/FileStorageRepository";
import type { ImportBatchRepository } from "../../src/domain/repositories/VehiclePlRepository";
import { buildMonthlyPlWorkbookFixture } from "../fixtures/monthlyPlWorkbook";

function fileStorageStub(onSave?: (fileName: string) => void): FileStorageRepository {
  return {
    save: async (_yearMonth, _fileType, fileName): Promise<StoredFileRef> => {
      onSave?.(fileName);
      return { key: "imports/2026-05/monthly_pl_workbook/sample.xlsx", size: 1, storedAt: 1 };
    },
    get: async () => null,
  };
}

function batchRepoStub(
  onRaw?: (rows: Parameters<ImportBatchRepository["saveRawIngestion"]>[3]) => void,
): ImportBatchRepository {
  return {
    createBatch: async () => undefined,
    saveRawIngestion: async (_batchId, _sourceType, _yearMonth, rows) => { onRaw?.(rows); },
    findRawRows: async () => [],
    findLatestBatch: async () => null,
  };
}

describe("ImportMonthlyPlWorkbookUseCase", () => {
  it("完成済みExcelを原本保存し、88888だけ除外して要確認の根拠を残す", async () => {
    const storedFiles: string[] = [];
    const rawCalls: Parameters<ImportBatchRepository["saveRawIngestion"]>[3][] = [];

    const result = await new ImportMonthlyPlWorkbookUseCase(
      fileStorageStub((fileName) => storedFiles.push(fileName)),
      batchRepoStub((rows) => rawCalls.push(rows)),
    ).execute({
      yearMonth: "2026-05",
      fileName: "名称が変わる収支表.xlsx",
      content: buildMonthlyPlWorkbookFixture(),
      importedBy: "user-1",
    });

    expect(storedFiles).toEqual(["名称が変わる収支表.xlsx"]);
    expect(result).toMatchObject({ totalRows: 2, vehicleCount: 1, charteredExcluded: 1, needsReviewCount: 1 });
    expect(rawCalls[0]).toHaveLength(1);
    expect(rawCalls[0]?.[0]?.flags).toEqual(["misc_driver_name", "duplicate_review_candidate"]);
  });

  /**
   * 業務フロー上、収支表はCSV(運行実績・売上モニタ・給与)と車両/運転者マスタ、そして手入力
   * だけから作られる。完成済みExcelはその入力ではなく、出来上がった表の答え合わせの相手でしかない。
   *
   * かつてこのユースケースはExcelの完成値を vehicle_pl へ直接書き、車両マスタや手入力欄まで
   * 更新していた。そのためCSVの紐付けが1本も通っていなくても表は完成してしまい、
   * 「CSVから作った表」と「Excelを写しただけの表」が画面上で見分けられなかった。
   * 依存を保管系の2つに閉じたことを、型ではなく実際の呼び出しで固定する。
   */
  it("原本保存と突合用の取込以外、計算に効くものは何も書かない", async () => {
    const save = vi.fn(async (): Promise<StoredFileRef> => ({ key: "k", size: 1, storedAt: 1 }));
    const createBatch = vi.fn(async () => undefined);
    const saveRawIngestion = vi.fn(async () => undefined);

    const useCase = new ImportMonthlyPlWorkbookUseCase(
      { save, get: async () => null },
      { createBatch, saveRawIngestion, findRawRows: async () => [], findLatestBatch: async () => null },
    );

    await useCase.execute({
      yearMonth: "2026-05",
      fileName: "収支表.xlsx",
      content: buildMonthlyPlWorkbookFixture(),
      importedBy: "user-1",
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(saveRawIngestion).toHaveBeenCalledTimes(1);
    // 収支表・車両マスタ・手入力・再計算のいずれにも依存を持たない(引数は2つだけ)。
    expect(ImportMonthlyPlWorkbookUseCase.length).toBe(2);
  });
});
