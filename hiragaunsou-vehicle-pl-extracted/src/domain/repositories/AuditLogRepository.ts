/**
 * 管理操作の監査ログ(誰が/いつ/何をしたか)。
 * 当面は取込バッチ削除(/admin/import-batches)のみで使う汎用インターフェース。
 */
export interface AuditLogEntry {
  actorId: string | null;
  actorName: string;
  action: string;
  summary: string;
  detail?: unknown;
}

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  summary: string;
  detail: unknown;
  createdAt: number;
}

export interface AuditLogRepository {
  record(entry: AuditLogEntry): Promise<void>;
  /** 直近のログを新しい順に返す(画面表示用。当面は用途を絞り件数上限を持つ)。 */
  listRecent(action: string, limit: number): Promise<AuditLogRecord[]>;
}
