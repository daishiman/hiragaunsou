import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./client";
import { annualReference } from "./schema";
import type {
  AnnualReferenceKind,
  AnnualReferenceRecord,
  AnnualReferenceRepository,
} from "../../domain/repositories/VehiclePlRepository";

/**
 * D1(Drizzle)による AnnualReferenceRepository の実装(Infrastructure層アダプタ)。
 * kind + year_month の一意制約で upsert する (再取込しても行が増えない)。
 */
export class D1AnnualReferenceRepository implements AnnualReferenceRepository {
  constructor(private readonly db: Db) {}

  async findByKind(
    kind: AnnualReferenceKind,
    yearMonths: readonly string[],
  ): Promise<AnnualReferenceRecord[]> {
    if (yearMonths.length === 0) return [];
    const rows = await this.db
      .select()
      .from(annualReference)
      .where(
        and(
          eq(annualReference.kind, kind),
          inArray(annualReference.yearMonth, [...yearMonths]),
        ),
      );
    return rows.map((r) => ({
      kind: r.kind as AnnualReferenceKind,
      yearMonth: r.yearMonth,
      sales: r.sales,
      expense: r.expense,
      note: r.note,
    }));
  }

  async upsertMany(
    records: readonly AnnualReferenceRecord[],
    updatedBy: string | null,
  ): Promise<void> {
    if (records.length === 0) return;
    const now = new Date();
    const statements = records.map((record) =>
      this.db
        .insert(annualReference)
        .values({
          id: `${record.kind}::${record.yearMonth}`,
          kind: record.kind,
          yearMonth: record.yearMonth,
          sales: record.sales,
          expense: record.expense,
          note: record.note,
          updatedAt: now,
          updatedBy,
        })
        .onConflictDoUpdate({
          target: [annualReference.kind, annualReference.yearMonth],
          set: {
            sales: record.sales,
            expense: record.expense,
            note: record.note,
            updatedAt: now,
            updatedBy,
          },
        }),
    );
    // D1に対話型トランザクションはないため batch() で原子性を担保する
    await this.db.batch(statements as unknown as [(typeof statements)[number]]);
  }
}
