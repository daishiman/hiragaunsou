import { gte, desc } from "drizzle-orm";
import type { Db } from "./client";
import { usageLog } from "./schema";
import type {
  UsageLogEntry,
  UsageLogRecord,
  UsageLogRepository,
} from "../../domain/repositories/UsageLogRepository";

/** D1(Drizzle)によるUsageLogRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1UsageLogRepository implements UsageLogRepository {
  constructor(private readonly db: Db) {}

  async record(entry: UsageLogEntry): Promise<void> {
    await this.db.insert(usageLog).values({
      id: crypto.randomUUID(),
      kind: entry.kind,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      recordedBy: entry.recordedBy,
      detailJson: entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
    });
  }

  async findSince(sinceMs: number): Promise<UsageLogRecord[]> {
    const rows = await this.db
      .select()
      .from(usageLog)
      .where(gte(usageLog.createdAt, new Date(sinceMs)))
      .orderBy(desc(usageLog.createdAt));

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      recordedBy: r.recordedBy,
      detail: r.detailJson ? (JSON.parse(r.detailJson) as unknown) : null,
      createdAt: r.createdAt.getTime(),
    }));
  }
}
