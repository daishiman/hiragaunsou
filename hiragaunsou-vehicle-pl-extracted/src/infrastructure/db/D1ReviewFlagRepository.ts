import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { reviewFlag } from "./schema";
import { chunkForD1 } from "./d1Limits";
import type { ReviewFlagRepository } from "../../domain/repositories/VehiclePlRepository";

/** review_flag への1行あたりのバインドパラメータ数(既定値を持つ列は指定しないため、列数より少ない)。 */
export const REVIEW_FLAG_COLUMNS = 9;

/** D1(Drizzle)によるReviewFlagRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1ReviewFlagRepository implements ReviewFlagRepository {
  constructor(private readonly db: Db) {}

  async createFlags(
    yearMonth: string,
    flags: {
      vehicleNo: string | null;
      field: string | null;
      type: string;
      severity: "info" | "warning" | "critical";
      message: string;
      monthlyReference: number | null;
    }[],
  ): Promise<void> {
    if (flags.length === 0) return;
    const values = flags.map((f) => ({
      id: crypto.randomUUID(),
      yearMonth,
      vehicleNo: f.vehicleNo,
      field: f.field,
      type: f.type,
      severity: f.severity,
      message: f.message,
      monthlyReference: f.monthlyReference,
      status: "open" as const,
    }));
    // 1行9列。D1の100パラメータ制限に収まるよう11行ずつに分割する。
    const statements = chunkForD1(values, REVIEW_FLAG_COLUMNS).map((chunk) =>
      this.db.insert(reviewFlag).values(chunk),
    );
    await this.db.batch(statements as unknown as [(typeof statements)[number]]);
  }

  async findOpenByYearMonth(yearMonth: string) {
    const rows = await this.db
      .select()
      .from(reviewFlag)
      .where(and(eq(reviewFlag.yearMonth, yearMonth), eq(reviewFlag.status, "open")));
    return rows.map((r) => ({
      id: r.id,
      vehicleNo: r.vehicleNo,
      field: r.field,
      type: r.type,
      severity: r.severity,
      message: r.message,
      status: r.status,
    }));
  }

  async resolve(
    id: string,
    resolvedBy: string,
    status: "corrected" | "approved" | "dismissed",
    note: string | null,
  ): Promise<void> {
    await this.db
      .update(reviewFlag)
      .set({ status, resolvedBy, resolvedAt: new Date(), resolutionNote: note })
      .where(eq(reviewFlag.id, id));
  }
}
