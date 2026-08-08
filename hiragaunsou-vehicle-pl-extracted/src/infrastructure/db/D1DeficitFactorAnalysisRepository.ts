import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { deficitFactorAnalysis } from "./schema";
import type {
  DeficitFactorAnalysisRecord,
  DeficitFactorAnalysisRepository,
  DeficitFactorAnalysisUpsertInput,
  DeficitFactorItem,
} from "../../domain/repositories/DeficitFactorAnalysisRepository";

function mapRow(row: typeof deficitFactorAnalysis.$inferSelect): DeficitFactorAnalysisRecord {
  return {
    vehicleNo: row.vehicleNo,
    yearMonth: row.yearMonth,
    summary: row.summary,
    factors: JSON.parse(row.factorsJson) as DeficitFactorItem[],
    model: row.model,
    profitAtAnalysis: row.profitAtAnalysis,
    updatedAt: row.updatedAt.getTime(),
  };
}

/** D1(Drizzle)によるDeficitFactorAnalysisRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1DeficitFactorAnalysisRepository implements DeficitFactorAnalysisRepository {
  constructor(private readonly db: Db) {}

  async findByYearMonth(yearMonth: string): Promise<DeficitFactorAnalysisRecord[]> {
    const rows = await this.db
      .select()
      .from(deficitFactorAnalysis)
      .where(eq(deficitFactorAnalysis.yearMonth, yearMonth));
    return rows.map(mapRow);
  }

  async findOne(vehicleNo: string, yearMonth: string): Promise<DeficitFactorAnalysisRecord | null> {
    const rows = await this.db
      .select()
      .from(deficitFactorAnalysis)
      .where(
        and(eq(deficitFactorAnalysis.yearMonth, yearMonth), eq(deficitFactorAnalysis.vehicleNo, vehicleNo)),
      )
      .limit(1);
    const row = rows[0];
    return row ? mapRow(row) : null;
  }

  async upsertMany(inputs: DeficitFactorAnalysisUpsertInput[], updatedBy: string | null): Promise<void> {
    for (const input of inputs) {
      const values = {
        yearMonth: input.yearMonth,
        vehicleNo: input.vehicleNo,
        summary: input.summary,
        factorsJson: JSON.stringify(input.factors),
        model: input.model,
        updatedAt: new Date(),
        updatedBy,
      };
      await this.db
        .insert(deficitFactorAnalysis)
        .values({ id: crypto.randomUUID(), ...values })
        .onConflictDoUpdate({
          target: [deficitFactorAnalysis.yearMonth, deficitFactorAnalysis.vehicleNo],
          set: values,
        });
    }
  }
}
