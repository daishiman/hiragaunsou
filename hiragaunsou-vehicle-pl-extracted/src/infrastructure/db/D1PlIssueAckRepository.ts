import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { plIssueAck } from "./schema";
import { user } from "./auth-schema";
import type { PlIssueAckRepository } from "../../domain/repositories/PlIssueAckRepository";
import { plIssueKey, type PlIssueAckKey, type PlIssueAckRecord } from "../../domain/rules/plIssueAck";
import type { ReviewIssueCode } from "../../domain/rules/vehiclePlReview";

/**
 * D1(Drizzle)による PlIssueAckRepository の実装(Infrastructure層アダプタ)。
 *
 * 確認済みの印は「誰が確認したか」が分からないと、後から判断を追えない。
 * updated_by だけでは画面に名前が出せないので user を join して返す
 * (D1VehiclePlOverrideRepository と同じ方針)。
 */
export class D1PlIssueAckRepository implements PlIssueAckRepository {
  constructor(private readonly db: Db) {}

  async findByYearMonth(yearMonth: string): Promise<PlIssueAckRecord[]> {
    const rows = await this.db
      .select({
        vehicleNo: plIssueAck.vehicleNo,
        field: plIssueAck.field,
        code: plIssueAck.code,
        note: plIssueAck.note,
        ackedAt: plIssueAck.ackedAt,
        ackedByName: user.name,
      })
      .from(plIssueAck)
      .leftJoin(user, eq(plIssueAck.ackedBy, user.id))
      .where(eq(plIssueAck.yearMonth, yearMonth));

    return rows.map((r) => ({
      vehicleNo: r.vehicleNo,
      field: r.field,
      code: r.code as ReviewIssueCode,
      note: r.note ?? null,
      ackedAt: r.ackedAt,
      ackedByName: r.ackedByName ?? null,
    }));
  }

  async save(
    yearMonth: string,
    key: PlIssueAckKey,
    note: string | null,
    ackedBy: string | null,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .insert(plIssueAck)
      .values({
        id: `${yearMonth}::${plIssueKey(key)}`,
        yearMonth,
        vehicleNo: key.vehicleNo,
        field: key.field,
        code: key.code,
        note,
        ackedAt: now,
        ackedBy,
      })
      .onConflictDoUpdate({
        target: [plIssueAck.yearMonth, plIssueAck.vehicleNo, plIssueAck.field, plIssueAck.code],
        set: { note, ackedAt: now, ackedBy },
      });
  }

  async remove(yearMonth: string, key: PlIssueAckKey): Promise<void> {
    await this.db
      .delete(plIssueAck)
      .where(
        and(
          eq(plIssueAck.yearMonth, yearMonth),
          eq(plIssueAck.vehicleNo, key.vehicleNo),
          eq(plIssueAck.field, key.field),
          eq(plIssueAck.code, key.code),
        ),
      );
  }
}
