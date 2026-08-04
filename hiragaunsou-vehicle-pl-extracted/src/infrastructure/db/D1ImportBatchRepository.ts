import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { csvImportBatch, rawIngestion } from "./schema";
import { chunkForD1 } from "./d1Limits";
import type { ImportBatchRepository } from "../../domain/repositories/VehiclePlRepository";

/**
 * raw_ingestion への1行あたりのバインドパラメータ数。
 * saveRawIngestion は全列を明示的に指定するため、スキーマの列数と必ず一致する。
 * ずれると分割サイズが実際より小さく見積もられ、D1の100パラメータ制限を超える。
 * ローカルのSQLite(上限999)では再現しないので、テストで列数と突き合わせる。
 */
export const RAW_INGESTION_COLUMNS = 8;

/** D1(Drizzle)によるImportBatchRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1ImportBatchRepository implements ImportBatchRepository {
  constructor(private readonly db: Db) {}

  async createBatch(input: {
    id: string;
    sourceType: string;
    yearMonth: string;
    fileName: string;
    importedBy: string | null;
    rowCount: number;
  }): Promise<void> {
    await this.db.insert(csvImportBatch).values({
      id: input.id,
      sourceType: input.sourceType,
      yearMonth: input.yearMonth,
      fileName: input.fileName,
      importedBy: input.importedBy,
      rowCount: input.rowCount,
      status: "completed",
    });
  }

  async saveRawIngestion(
    batchId: string,
    sourceType: string,
    yearMonth: string,
    rows: { rowIndex: number; naturalKey: string | null; raw: unknown; flags: string[] }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const values = rows.map((r) => ({
      id: crypto.randomUUID(),
      batchId,
      sourceType,
      yearMonth,
      rowIndex: r.rowIndex,
      naturalKey: r.naturalKey,
      rawJson: JSON.stringify(r.raw),
      flags: r.flags.length > 0 ? JSON.stringify(r.flags) : null,
    }));
    // 1行8列。D1は1クエリ100パラメータまでなので12行ずつに割り、batch()で原子性を担保する。
    const statements = chunkForD1(values, RAW_INGESTION_COLUMNS).map((chunk) =>
      this.db.insert(rawIngestion).values(chunk),
    );
    await this.db.batch(statements as unknown as [(typeof statements)[number]]);
  }

  async findBatches(yearMonth: string, sourceType: string) {
    const rows = await this.db
      .select()
      .from(csvImportBatch)
      .where(and(eq(csvImportBatch.yearMonth, yearMonth), eq(csvImportBatch.sourceType, sourceType)))
      .orderBy(desc(csvImportBatch.importedAt));
    return rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      rowCount: r.rowCount,
      importedAt: r.importedAt.getTime(),
    }));
  }

  async deleteBatches(yearMonth: string, sourceType: string, batchIds: string[]): Promise<number> {
    if (batchIds.length === 0) return 0;
    // batch_id 単独の索引は書き込みコスト削減のため持たない(schema.ts参照)。
    // 代わりに year_month + source_type の複合索引でその月のその帳票だけに絞り、
    // その中で batch_id を突き合わせる。走査対象は1か月分の取込行だけで済む。
    const scope = and(
      eq(rawIngestion.yearMonth, yearMonth),
      eq(rawIngestion.sourceType, sourceType),
      inArray(rawIngestion.batchId, batchIds),
    );
    const [{ count = 0 } = {}] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(rawIngestion)
      .where(scope);

    // raw_ingestion は csv_import_batch への ON DELETE CASCADE を持つが、
    // 外部キーの有効/無効に依存せず消えることを保証するため明示的に両方消す。
    await this.db.batch([
      this.db.delete(rawIngestion).where(scope),
      this.db.delete(csvImportBatch).where(inArray(csvImportBatch.id, batchIds)),
    ]);
    return count;
  }

  async findRawRows(
    yearMonth: string,
    sourceType: string,
  ): Promise<{ naturalKey: string | null; raw: unknown; flags: string[] }[]> {
    const rows = await this.db
      .select()
      .from(rawIngestion)
      .where(and(eq(rawIngestion.yearMonth, yearMonth), eq(rawIngestion.sourceType, sourceType)));

    return rows.map((r) => ({
      naturalKey: r.naturalKey,
      raw: JSON.parse(r.rawJson) as unknown,
      flags: r.flags ? (JSON.parse(r.flags) as string[]) : [],
    }));
  }

  async findLatestBatch(
    yearMonth: string,
    sourceType: string,
  ): Promise<{
    id: string;
    fileName: string;
    rowCount: number;
    importedAt: number;
    status: string;
  } | null> {
    const rows = await this.db
      .select()
      .from(csvImportBatch)
      .where(and(eq(csvImportBatch.yearMonth, yearMonth), eq(csvImportBatch.sourceType, sourceType)))
      .orderBy(desc(csvImportBatch.importedAt))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      fileName: row.fileName,
      rowCount: row.rowCount,
      importedAt: row.importedAt.getTime(),
      status: row.status,
    };
  }
}
