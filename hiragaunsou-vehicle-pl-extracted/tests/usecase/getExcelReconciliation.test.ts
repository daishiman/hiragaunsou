import { describe, expect, it } from "vitest";
import { GetExcelReconciliationUseCase } from "../../src/usecase/steps/getExcelReconciliation";
import type { ImportBatchRepository } from "../../src/domain/repositories/VehiclePlRepository";
import type { VehiclePlCalculated } from "../../src/domain/rules/vehiclePlCalculation";
import { plRow } from "../fixtures/vehiclePlRow";
import { stubVehiclePlRepo } from "../fixtures/stubRepositories";

/**
 * 完成済みExcelの生データ(raw_ingestion)を返すだけの最小スタブ。
 * findRawRows の戻り値の `raw` は unknown で保存されており、ユースケースが
 * VehiclePlCalculated として扱う前提を検証する。
 */
function stubImportBatchRepo(rawRows: { raw: unknown }[]): ImportBatchRepository {
  return {
    createBatch: async () => {},
    saveRawIngestion: async () => {},
    findRawRows: async () => rawRows.map((r) => ({ naturalKey: null, raw: r.raw, flags: [] })),
  } as unknown as ImportBatchRepository;
}

describe("GetExcelReconciliationUseCase", () => {
  it("完成済みExcelの生データと収支確定後のvehicle_plを車番別に突合する", async () => {
    const excelRow = plRow({ no: "1", sales: 100 }) as VehiclePlCalculated;
    const systemRow = plRow({ no: "1", sales: 300 });
    const useCase = new GetExcelReconciliationUseCase(
      stubVehiclePlRepo({ "2026-05": [systemRow] }),
      stubImportBatchRepo([{ raw: excelRow }]),
    );

    const result = await useCase.execute("2026-05");

    expect(result.hasExcel).toBe(true);
    expect(result.comparedCount).toBe(1);
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]).toMatchObject({ vehicleNo: "1" });
    expect(result.vehicles[0]?.items[0]).toMatchObject({ excel: 100, system: 300, diff: 200 });
  });

  it("Excelが未取込(raw_ingestionが0件)なら突合せず、hasExcel=falseを返す", async () => {
    const useCase = new GetExcelReconciliationUseCase(
      stubVehiclePlRepo({ "2026-05": [plRow({ no: "1" })] }),
      stubImportBatchRepo([]),
    );

    const result = await useCase.execute("2026-05");

    expect(result.hasExcel).toBe(false);
    expect(result.comparedCount).toBe(0);
    expect(result.vehicles).toEqual([]);
  });

  it("車番(no)が文字列でない、または空文字の生データは突合対象から除外する(壊れた取込データを混ぜない)", async () => {
    const validRow = plRow({ no: "1", sales: 100 });
    const useCase = new GetExcelReconciliationUseCase(
      stubVehiclePlRepo({ "2026-05": [plRow({ no: "1", sales: 300 })] }),
      stubImportBatchRepo([
        { raw: validRow },
        { raw: { ...plRow({ no: "2" }), no: "" } }, // 車番が空文字
        { raw: { ...plRow({ no: "3" }), no: 3 } }, // 車番が数値(文字列でない)
        { raw: null }, // rawそのものが欠損
      ]),
    );

    const result = await useCase.execute("2026-05");

    // 有効な1件だけが突合対象になる(comparedCount=1)。壊れた3件は無視され例外にもならない。
    expect(result.comparedCount).toBe(1);
    expect(result.excelOnlyCount).toBe(0);
  });

  it("システム側に無い車番はexcelOnlyCountとして数えるだけで、突合一覧には出さない", async () => {
    const useCase = new GetExcelReconciliationUseCase(
      stubVehiclePlRepo({ "2026-05": [] }),
      stubImportBatchRepo([{ raw: plRow({ no: "9", sales: 100 }) }]),
    );

    const result = await useCase.execute("2026-05");

    expect(result.comparedCount).toBe(0);
    expect(result.excelOnlyCount).toBe(1);
    expect(result.vehicles).toEqual([]);
  });
});
