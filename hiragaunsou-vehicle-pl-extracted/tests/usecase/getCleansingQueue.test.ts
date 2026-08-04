import { describe, expect, it } from "vitest";
import { GetCleansingQueueUseCase } from "../../src/usecase/steps/getCleansingQueue";
import { stubCleansingDecisionRepo } from "../fixtures/stubRepositories";
import type { SalesMonitorRow } from "../../src/infrastructure/parsers/salesMonitorParser";
import type { ImportBatchRepository } from "../../src/domain/repositories/VehiclePlRepository";
import type { CleansingDecisionRecord } from "../../src/domain/repositories/CleansingDecisionRepository";

const YM = "2026-05";

function row(overrides: Partial<SalesMonitorRow> = {}): SalesMonitorRow {
  return {
    vehicleCode: "24",
    driverName: "山田",
    fare: 10000,
    toll: 0,
    ancillaryFee: 0,
    isChartered: false,
    needsReview: false,
    reviewReason: null,
    slipNo: "S001",
    lineNo: "1",
    customerName: "キリン",
    loadDate: "2026-05-01",
    ...overrides,
  };
}

/** 売上モニタリストの生行と、取込時の傭車除外件数を与えるスタブ */
function batchRepo(rows: SalesMonitorRow[], excludedRowCount = 0): ImportBatchRepository {
  return {
    createBatch: async () => {},
    saveRawIngestion: async () => {},
    findRawRows: async () => rows.map((r) => ({ naturalKey: r.vehicleCode, raw: r, flags: [] })),
    findLatestBatch: async () =>
      rows.length === 0
        ? null
        : {
            id: "b1",
            fileName: "sales.csv",
            rowCount: rows.length,
            excludedRowCount,
            importedAt: 0,
            status: "completed",
          },
    countRawRowsWithFlags: async () => 0,
  };
}

function useCase(
  rows: SalesMonitorRow[],
  opts: {
    excludedRowCount?: number;
    decisions?: CleansingDecisionRecord[];
    previous?: CleansingDecisionRecord[];
  } = {},
) {
  return new GetCleansingQueueUseCase(
    batchRepo(rows, opts.excludedRowCount ?? 0),
    stubCleansingDecisionRepo(opts.decisions ?? [], opts.previous ?? []),
  );
}

describe("GetCleansingQueueUseCase (業務フロー STEP1 データ整形)", () => {
  it("未取込なら notImported を返し、判断リストは空にする", async () => {
    const result = await useCase([]).execute(YM);
    expect(result.notImported).toBe(true);
    expect(result.items).toEqual([]);
  });

  it("フラグが立たない伝票は判断リストに出さない(全件を人に見せない)", async () => {
    const result = await useCase([row(), row({ slipNo: "S002" })]).execute(YM);
    expect(result.notImported).toBe(false);
    expect(result.totalRows).toBe(2);
    expect(result.items).toEqual([]);
    expect(result.pendingCount).toBe(0);
  });

  it("諸口・2重計上の疑いだけを判断リストに出す", async () => {
    const result = await useCase([
      row(),
      row({ slipNo: "S002", driverName: "諸口" }),
      row({ slipNo: "S003", vehicleCode: "888" }),
    ]).execute(YM);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.rowKey).sort()).toEqual(["S002-1", "S003-1"]);
    expect(result.pendingCount).toBe(2);
  });

  it("傭車の自動除外件数は取込バッチから取る(生データには残っていないため)", async () => {
    const result = await useCase([row()], { excludedRowCount: 12 }).execute(YM);
    expect(result.charteredExcluded).toBe(12);
  });

  it("判断済みの伝票は decision が入り、未判断件数から外れる", async () => {
    const result = await useCase([row({ driverName: "諸口" })], {
      decisions: [
        {
          yearMonth: YM,
          sourceType: "sales_monitor",
          rowKey: "S001-1",
          vehicleNo: "24",
          driverName: "諸口",
          flagTypes: ["misc_entry"],
          decision: "delete",
          correctedVehicleNo: null,
          note: "重複のため",
        },
      ],
    }).execute(YM);

    expect(result.items[0]?.decision).toBe("delete");
    expect(result.items[0]?.note).toBe("重複のため");
    expect(result.pendingCount).toBe(0);
    expect(result.excludedCount).toBe(1);
  });

  it("前月の判断があれば提案として添える(自動適用はしない)", async () => {
    const result = await useCase([row({ driverName: "諸口" })], {
      previous: [
        {
          yearMonth: "2026-04",
          sourceType: "sales_monitor",
          rowKey: "S001-1",
          vehicleNo: "24",
          driverName: "諸口",
          flagTypes: ["misc_entry"],
          decision: "keep",
          correctedVehicleNo: null,
          note: null,
        },
      ],
    }).execute(YM);

    expect(result.items[0]?.decision).toBeNull();
    expect(result.items[0]?.suggestion?.decision).toBe("keep");
    expect(result.items[0]?.suggestion?.reason).toContain("2026-04");
  });

  it("未判断を先に、そのなかは金額の大きい順に並べる", async () => {
    const result = await useCase(
      [
        row({ slipNo: "S001", driverName: "諸口", fare: 1000 }),
        row({ slipNo: "S002", driverName: "諸口", fare: 90000 }),
        row({ slipNo: "S003", driverName: "諸口", fare: 50000 }),
      ],
      {
        decisions: [
          {
            yearMonth: YM,
            sourceType: "sales_monitor",
            rowKey: "S002-1",
            vehicleNo: "24",
            driverName: "諸口",
            flagTypes: ["misc_entry"],
            decision: "keep",
            correctedVehicleNo: null,
            note: null,
          },
        ],
      },
    ).execute(YM);

    expect(result.items.map((i) => i.rowKey)).toEqual(["S003-1", "S001-1", "S002-1"]);
  });

  it("金額は受取運賃と附帯料金の合計にする(判断の優先順位に使う)", async () => {
    const result = await useCase([
      row({ driverName: "諸口", fare: 80000, ancillaryFee: 5000 }),
    ]).execute(YM);
    expect(result.items[0]?.amount).toBe(85000);
  });
});
