import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { csvImportBatch, rawIngestion } from "./schema";
import type { ImportBatchRepository } from "../../domain/repositories/VehiclePlRepository";

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
    await this.db.insert(rawIngestion).values(
      rows.map((r) => ({
        id: crypto.randomUUID(),
        batchId,
        sourceType,
        yearMonth,
        rowIndex: r.rowIndex,
        naturalKey: r.naturalKey,
        rawJson: JSON.stringify(r.raw),
        flags: r.flags.length > 0 ? JSON.stringify(r.flags) : null,
      })),
    );
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
