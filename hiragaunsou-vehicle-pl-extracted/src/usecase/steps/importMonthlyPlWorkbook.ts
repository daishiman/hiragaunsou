import { isCharteredVehicle } from "../../domain/rules/charteredVehicle";
import type { FileStorageRepository } from "../../domain/repositories/FileStorageRepository";
import type { ImportBatchRepository, VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type {
  VehicleMasterRepository,
  VehicleMasterUpsertInput,
} from "../../domain/repositories/MasterRepository";
import type { AuditLogRepository } from "../../domain/repositories/AuditLogRepository";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";
import { parseMonthlyPlWorkbook } from "../../infrastructure/parsers/monthlyPlWorkbookParser";
import { mapVehicleTypeToCostCategory } from "../../infrastructure/parsers/vehicleMasterParser";

/** 既存Excelの完成済み「○月収支表」を、移行期間の正本データとして取り込む種別。 */
export const MONTHLY_PL_WORKBOOK_SOURCE_TYPE = "monthly_pl_workbook";

/** Excel取込に伴う車両マスタ自動更新。手動CSV取込(import_vehicle_master)と区別する。 */
export const SYNC_VEHICLE_MASTER_ACTION = "sync_vehicle_master_from_workbook";

/** 車両マスタに反映できなかった行と、その理由。 */
export interface VehicleMasterSyncSkip {
  vehicleNo: string;
  vehicleType: string;
  reason: string;
}

export interface VehicleMasterSyncResult {
  inserted: number;
  updated: number;
  skipped: VehicleMasterSyncSkip[];
}

/**
 * 収支表の行から車両マスタ相当の9項目を抜き出す。
 *
 * 収支表は毎月そのExcelが正本として更新されるため、取り込むたびに全件を上書きする。
 * 車種名から原価カテゴリを判定できない行は、既定値に丸めると修繕費・タイヤ費の単価が
 * 誤ったまま気付かれずに残るため、更新せず理由付きで返して人が対処できるようにする。
 * 同じ車番が複数行ある場合は後勝ち(シート下方の行が新しい前提)。
 */
export function buildVehicleMasterRecords(rows: readonly VehiclePlCalculated[]): {
  records: VehicleMasterUpsertInput[];
  skipped: VehicleMasterSyncSkip[];
} {
  const byVehicleNo = new Map<string, VehicleMasterUpsertInput>();
  const skipped: VehicleMasterSyncSkip[] = [];

  for (const row of rows) {
    const vehicleNo = row.no.trim();
    if (vehicleNo === "") continue;

    const costCategory = mapVehicleTypeToCostCategory(row.type);
    if (costCategory === null) {
      skipped.push({
        vehicleNo,
        vehicleType: row.type,
        reason: `車種名「${row.type}」から原価カテゴリを判定できません`,
      });
      continue;
    }

    byVehicleNo.set(vehicleNo, {
      vehicleNo,
      vehicleType: row.type,
      depot: row.depot,
      costCategory,
      insCompulsory: row.insCompulsory,
      insVoluntary: row.insVoluntary,
      taxAuto: row.taxAuto,
      taxWeight: row.taxWeight,
      lease: row.lease,
      installment: row.installment,
    });
  }

  return { records: [...byVehicleNo.values()], skipped };
}

export interface ImportMonthlyPlWorkbookInput {
  yearMonth: string;
  fileName: string;
  content: ArrayBuffer | Uint8Array;
  importedBy: string | null;
  /** 監査ログに残す実行者の表示名。未指定ならIDで代替する。 */
  importedByName?: string | null;
}

export interface ImportMonthlyPlWorkbookResult {
  batchId: string;
  storedFileKey: string;
  sourceSheet: string;
  totalRows: number;
  vehicleCount: number;
  charteredExcluded: number;
  needsReviewCount: number;
  /** 車両マスタの自動更新結果。連携先が未設定の場合は null。 */
  vehicleMasterSync: VehicleMasterSyncResult | null;
}

/**
 * STEP 7〜8の既存成果物をD1に移すユースケース。
 * CSV/PDF取込の完全自動化へ移行する間も、毎月の完成表をWebで閲覧・比較できるようにする。
 * 「88888」だけは確定ルールなので除外し、諸口・過去実績のある重複候補は消さずに要確認として残す。
 */
export class ImportMonthlyPlWorkbookUseCase {
  constructor(
    private readonly fileStorage: FileStorageRepository,
    private readonly importBatchRepo: ImportBatchRepository,
    private readonly vehiclePlRepo: VehiclePlRepository,
    /**
     * 収支表から車両マスタを自動更新するための連携先。
     * 未指定でも取込自体は成立させたいため任意とし、その場合はマスタ更新を行わない。
     */
    private readonly vehicleMasterRepo?: VehicleMasterRepository,
    private readonly auditLog?: AuditLogRepository,
  ) {}

  async execute(input: ImportMonthlyPlWorkbookInput): Promise<ImportMonthlyPlWorkbookResult> {
    const stored = await this.fileStorage.save(
      input.yearMonth,
      MONTHLY_PL_WORKBOOK_SOURCE_TYPE,
      input.fileName,
      input.content,
    );
    const parsed = parseMonthlyPlWorkbook(input.content, input.yearMonth);
    const charteredExcluded = parsed.rows.filter((row) => isCharteredVehicle(row.no)).length;
    const kept = parsed.rows.filter((row) => !isCharteredVehicle(row.no));
    const batchId = crypto.randomUUID();
    const rawRows = kept.map((row, rowIndex) => ({
      rowIndex,
      naturalKey: row.no,
      raw: row,
      flags: reviewFlags(row.no, row.driver),
    }));

    await this.importBatchRepo.createBatch({
      id: batchId,
      sourceType: MONTHLY_PL_WORKBOOK_SOURCE_TYPE,
      yearMonth: input.yearMonth,
      fileName: input.fileName,
      importedBy: input.importedBy,
      rowCount: kept.length,
    });
    await this.importBatchRepo.saveRawIngestion(
      batchId,
      MONTHLY_PL_WORKBOOK_SOURCE_TYPE,
      input.yearMonth,
      rawRows,
    );
    await this.vehiclePlRepo.upsertMany(input.yearMonth, kept);
    const vehicleMasterSync = await this.syncVehicleMaster(input, kept);

    return {
      batchId,
      storedFileKey: stored.key,
      sourceSheet: parsed.sheetName,
      totalRows: parsed.rows.length,
      vehicleCount: kept.length,
      charteredExcluded,
      needsReviewCount: rawRows.filter((row) => row.flags.length > 0).length,
      vehicleMasterSync,
    };
  }

  /**
   * 収支表の内容で車両マスタを上書きする。
   * 保険料・税・リース料は収支計算の土台であり、毎月の取込のたびに最新化されるべき情報だが、
   * ここで失敗しても収支表そのものの取込は成立している。マスタ更新の失敗で取込全体を
   * ロールバック扱いにすると再取込を強いることになるため、例外は握らず監査ログの記録のみ行う。
   */
  private async syncVehicleMaster(
    input: ImportMonthlyPlWorkbookInput,
    rows: readonly VehiclePlCalculated[],
  ): Promise<VehicleMasterSyncResult | null> {
    if (!this.vehicleMasterRepo) return null;

    const { records, skipped } = buildVehicleMasterRecords(rows);
    if (records.length === 0) return { inserted: 0, updated: 0, skipped };

    const { inserted, updated } = await this.vehicleMasterRepo.upsertMany(records);

    await this.auditLog?.record({
      actorId: input.importedBy,
      actorName: input.importedByName ?? input.importedBy ?? "system",
      action: SYNC_VEHICLE_MASTER_ACTION,
      summary:
        `${input.yearMonth}の収支表取込により車両マスタ ${records.length}件を自動更新` +
        `(新規${inserted}件・更新${updated}件` +
        (skipped.length > 0 ? `・対象外${skipped.length}件` : "") +
        ")",
      detail: {
        yearMonth: input.yearMonth,
        fileName: input.fileName,
        total: records.length,
        inserted,
        updated,
        vehicleNos: records.map((r) => r.vehicleNo),
        skipped,
      },
    });

    return { inserted, updated, skipped };
  }
}

function reviewFlags(vehicleNo: string, driver: string | null): string[] {
  const flags: string[] = [];
  if (driver?.includes("諸口")) flags.push("misc_driver_name");
  // 過去に二重計上の実績がある車番。自動削除ではなく、請求担当への確認対象として残す。
  if (["10", "888", "5000"].includes(vehicleNo)) flags.push("duplicate_review_candidate");
  return flags;
}
