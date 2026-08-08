import type {
  AnnualReferenceRecord,
  AnnualReferenceRepository,
  ImportBatchRepository,
  ReviewFlagRepository,
  VehiclePlRepository,
} from "../../src/domain/repositories/VehiclePlRepository";
import type {
  ManualInputRecord,
  ManualInputRepository,
} from "../../src/domain/repositories/ManualInputRepository";
import type { RateMasterRepository } from "../../src/domain/repositories/MasterRepository";
import type {
  CleansingDecisionRecord,
  CleansingDecisionRepository,
} from "../../src/domain/repositories/CleansingDecisionRepository";
import { DEFAULT_DEFICIT_THRESHOLDS } from "../../src/domain/rules/deficitClassification";
import {
  DEFAULT_RATE_SETTINGS,
  type VehiclePlCalculated,
} from "../../src/domain/rules/vehiclePlCalculation";

/** 年月 → 行 のマップを与えるだけで済む収支リポジトリのスタブ */
export function stubVehiclePlRepo(
  byMonth: Record<string, VehiclePlCalculated[]>,
  /** 確定済みにしたい年月 (STEP8の確定判定を試すとき) */
  confirmedMonths: readonly string[] = [],
): VehiclePlRepository {
  const confirmed = new Set(confirmedMonths);
  return {
    getConfirmation: async (ym) => ({
      total: (byMonth[ym] ?? []).length,
      confirmed: confirmed.has(ym) ? (byMonth[ym] ?? []).length : 0,
    }),
    setConfirmed: async (ym, value) => {
      if (value) confirmed.add(ym);
      else confirmed.delete(ym);
    },
    upsertMany: async () => {},
    findByYearMonth: async (ym) => byMonth[ym] ?? [],
    findByYearMonths: async (yms) =>
      new Map(yms.map((ym) => [ym, byMonth[ym] ?? []])),
    findByVehicleNo: async (no) =>
      Object.values(byMonth)
        .flat()
        .filter((r) => r.no === no),
    countByYearMonth: async (ym) => (byMonth[ym] ?? []).length,
  };
}

export function stubReviewFlagRepo(
  flags: Awaited<ReturnType<ReviewFlagRepository["findOpenByYearMonth"]>>,
): ReviewFlagRepository {
  return {
    createFlags: async () => {},
    findOpenByYearMonth: async () => flags,
    resolve: async () => {},
    reopen: async () => {},
  };
}

export function stubRateMasterRepo(
  overrides: Partial<Awaited<ReturnType<RateMasterRepository["getDeficitThresholds"]>>> = {},
): RateMasterRepository {
  return {
    // 率の具体値はテストの検証対象ではないので既定値を借りる。ここに数値を書くと
    // 既定値を変えたときにスタブだけが古い値を返し、齟齬が見えなくなる。
    getRates: async () => ({ ...DEFAULT_RATE_SETTINGS, tankPricePerLiter: 120 }),
    getDeficitThresholds: async () => ({ ...DEFAULT_DEFICIT_THRESHOLDS, ...overrides }),
    setRate: async () => {},
  };
}

/** 空の手入力レコード。テストでは必要な項目だけ上書きする */
export function manualInput(
  vehicleNo: string,
  overrides: Partial<ManualInputRecord> = {},
): ManualInputRecord {
  return {
    vehicleNo,
    fuelInQty: 0,
    fuelOut: 0,
    fuelOutQty: 0,
    adblue: 0,
    repairActual: 0,
    tireActual: null,
    equip: 0,
    mainte: 0,
    tollActual: null,
    tollDiscountActual: null,
    miscOther: 0,
    ...overrides,
  };
}

export function stubManualInputRepo(records: ManualInputRecord[] = []): ManualInputRepository {
  return {
    findByYearMonth: async () => records,
    upsertMany: async () => {},
  };
}

/** 年月+ソース種別 → 取込済みバッチ。キーは `${yearMonth}:${sourceType}` */
export function stubImportBatchRepo(
  batches: Record<
    string,
    { fileName: string; rowCount: number; excludedRowCount?: number; flaggedRowCount?: number }
  > = {},
): ImportBatchRepository {
  return {
    createBatch: async () => {},
    saveRawIngestion: async () => {},
    findRawRows: async () => [],
    findLatestBatch: async (yearMonth, sourceType) => {
      const b = batches[`${yearMonth}:${sourceType}`];
      if (!b) return null;
      return {
        id: `${yearMonth}-${sourceType}`,
        fileName: b.fileName,
        rowCount: b.rowCount,
        excludedRowCount: b.excludedRowCount ?? 0,
        importedAt: 0,
        status: "completed",
      };
    },
    countRawRowsWithFlags: async (yearMonth, sourceType) =>
      batches[`${yearMonth}:${sourceType}`]?.flaggedRowCount ?? 0,
  };
}

/** STEP1 データ整形の判断履歴スタブ。キーは rowKey */
export function stubCleansingDecisionRepo(
  decisions: CleansingDecisionRecord[] = [],
  previous: CleansingDecisionRecord[] = [],
): CleansingDecisionRepository {
  return {
    findByYearMonth: async (yearMonth, sourceType) =>
      decisions.filter((d) => d.yearMonth === yearMonth && d.sourceType === sourceType),
    countByYearMonth: async (yearMonth, sourceType) =>
      decisions.filter((d) => d.yearMonth === yearMonth && d.sourceType === sourceType).length,
    findPreviousDecisions: async (sourceType, rowKeys, beforeYearMonth) =>
      previous.filter(
        (d) =>
          d.sourceType === sourceType &&
          rowKeys.includes(d.rowKey) &&
          d.yearMonth < beforeYearMonth,
      ),
    upsertMany: async () => {},
  };
}

export function stubAnnualReferenceRepo(
  records: AnnualReferenceRecord[] = [],
): AnnualReferenceRepository {
  return {
    findByKind: async (kind, yearMonths) =>
      records.filter((r) => r.kind === kind && yearMonths.includes(r.yearMonth)),
    upsertMany: async () => {},
  };
}
