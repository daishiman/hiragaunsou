import type { D1ImportBatchRepository } from "../../infrastructure/db/D1ImportBatchRepository";
import type { AuditLogRepository, AuditLogRecord } from "../../domain/repositories/AuditLogRepository";
import { findImportSource } from "../../domain/rules/importSources";
import { SOURCE_TYPES } from "../../infrastructure/db/schema";

export const DELETE_IMPORT_BATCH_ACTION = "delete_import_batch";

export interface ImportBatchSummary {
  id: string;
  sourceType: string;
  yearMonth: string;
  fileName: string;
  rowCount: number;
  excludedRowCount: number;
  status: string;
  importedAt: number;
  importedByName: string | null;
}

/**
 * 管理者による全期間・全帳票種別の取込バッチ一覧取得(/admin/import-batches 画面)。
 * 誤って別の月/帳票のデータが混入した場合の発見・削除のための「全件見える」画面。
 */
export class ListImportBatchesUseCase {
  constructor(private readonly repo: D1ImportBatchRepository) {}

  async execute(): Promise<ImportBatchSummary[]> {
    return this.repo.listAll();
  }
}

export interface DeleteImportBatchInput {
  actorId: string;
  actorName: string;
  batchId: string;
}

/**
 * 管理者による取込バッチの削除。
 * 対象バッチに紐づく raw_ingestion も (D1ImportBatchRepository.deleteBatches 経由で) 一緒に消し、
 * 「誰が・いつ・何を消したか」を admin_audit_log に記録する(再発防止・追跡のため)。
 */
export class DeleteImportBatchUseCase {
  constructor(
    private readonly repo: D1ImportBatchRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: DeleteImportBatchInput): Promise<void> {
    const batch = await this.repo.findById(input.batchId);
    if (!batch) {
      throw new Error("対象の取込バッチが見つかりません(既に削除されている可能性があります)");
    }

    const deletedRawRows = await this.repo.deleteBatches(batch.yearMonth, batch.sourceType, [batch.id]);

    const sourceLabel = findImportSource(batch.sourceType)?.label ?? "判別できない帳票";
    const summary = `${batch.yearMonth} ${sourceLabel}「${batch.fileName}」（${batch.rowCount}件）を削除`;
    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: DELETE_IMPORT_BATCH_ACTION,
      summary,
      detail: { ...batch, deletedRawRows },
    });
  }
}

/** 管理者による削除履歴の確認(/admin/import-batches 画面下部)。 */
export class ListImportBatchDeletionLogUseCase {
  constructor(private readonly auditLog: AuditLogRepository) {}

  async execute(limit = 50): Promise<AuditLogRecord[]> {
    return this.auditLog.listRecent(DELETE_IMPORT_BATCH_ACTION, limit);
  }
}

export const KNOWN_SOURCE_TYPES: readonly string[] = SOURCE_TYPES;
