import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { reviewFlag } from "./schema";
import type { ReviewFlagRepository } from "../../domain/repositories/VehiclePlRepository";

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
    await this.db.insert(reviewFlag).values(
      flags.map((f) => ({
        id: crypto.randomUUID(),
        yearMonth,
        vehicleNo: f.vehicleNo,
        field: f.field,
        type: f.type,
        severity: f.severity,
        message: f.message,
        monthlyReference: f.monthlyReference,
        status: "open" as const,
      })),
    );
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
