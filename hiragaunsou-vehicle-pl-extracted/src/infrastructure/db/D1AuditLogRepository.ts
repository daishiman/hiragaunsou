import { desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { adminAuditLog } from "./schema";
import type { AuditLogEntry, AuditLogRecord, AuditLogRepository } from "../../domain/repositories/AuditLogRepository";

/** D1(Drizzle)によるAuditLogRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1AuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Db) {}

  async record(entry: AuditLogEntry): Promise<void> {
    await this.db.insert(adminAuditLog).values({
      id: crypto.randomUUID(),
      actorId: entry.actorId,
      actorName: entry.actorName,
      action: entry.action,
      summary: entry.summary,
      detailJson: entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
    });
  }

  async listRecent(action: string, limit: number): Promise<AuditLogRecord[]> {
    const rows = await this.db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, action))
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorName: r.actorName,
      action: r.action,
      summary: r.summary,
      detail: r.detailJson ? (JSON.parse(r.detailJson) as unknown) : null,
      createdAt: r.createdAt.getTime(),
    }));
  }
}
