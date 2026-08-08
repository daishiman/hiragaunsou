import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { plIssueAck } from "./schema";
import { user } from "./auth-schema";
import type {
  PlIssueAckInput,
  PlIssueAckRepository,
} from "../../domain/repositories/PlIssueAckRepository";
import {
  isPlIssueAckStatus,
  plIssueKey,
  type PlIssueAckKey,
  type PlIssueAckRecord,
} from "../../domain/rules/plIssueAck";
import type { ReviewIssueCode } from "../../domain/rules/vehiclePlReview";

/** 一度のまとめ書きで受ける上限。D1のバインド変数の上限と、押し間違いの被害の大きさの両方を抑える。 */
export const MAX_BULK_ACK = 200;

/**
 * D1(Drizzle)による PlIssueAckRepository の実装(Infrastructure層アダプタ)。
 *
 * 判断の印は「誰が判断したか」が分からないと、後から判断を追えない。
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
        status: plIssueAck.status,
        note: plIssueAck.note,
        valueAtAck: plIssueAck.valueAtAck,
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
      // 古い行や想定外の値が入っていても画面を壊さない。判断が読めないものは「問題なし」として扱う
      // (この列を足す前の行はすべて問題なしの判断だったため)。
      status: isPlIssueAckStatus(r.status) ? r.status : "ok",
      note: r.note ?? null,
      valueAtAck: r.valueAtAck ?? null,
      ackedAt: r.ackedAt,
      ackedByName: r.ackedByName ?? null,
    }));
  }

  async save(yearMonth: string, key: PlIssueAckKey, input: PlIssueAckInput): Promise<void> {
    await this.saveMany(yearMonth, [{ key, input }]);
  }

  async saveMany(
    yearMonth: string,
    entries: readonly { key: PlIssueAckKey; input: PlIssueAckInput }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    if (entries.length > MAX_BULK_ACK) {
      throw new Error(`一度にまとめて処理できるのは${MAX_BULK_ACK}件までです`);
    }
    const now = new Date();
    // D1は1文にまとめられる件数に上限があるため、小分けにして順に流す。
    const chunkSize = 50;
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      await this.db
        .insert(plIssueAck)
        .values(
          chunk.map(({ key, input }) => ({
            id: `${yearMonth}::${plIssueKey(key)}`,
            yearMonth,
            vehicleNo: key.vehicleNo,
            field: key.field,
            code: key.code,
            status: input.status,
            note: input.note,
            valueAtAck: input.valueAtAck,
            ackedAt: now,
            ackedBy: input.ackedBy,
          })),
        )
        .onConflictDoUpdate({
          target: [plIssueAck.yearMonth, plIssueAck.vehicleNo, plIssueAck.field, plIssueAck.code],
          // 行ごとに値が違うので、いま入れようとした行の値 (excluded) で上書きする。
          // ここを固定値にすると、まとめ書きの2件目以降が1件目の値で塗られる。
          set: {
            status: sql`excluded.status`,
            note: sql`excluded.note`,
            valueAtAck: sql`excluded.value_at_ack`,
            ackedAt: now,
            ackedBy: sql`excluded.acked_by`,
          },
        });
    }
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

  async removeMany(yearMonth: string, keys: readonly PlIssueAckKey[]): Promise<void> {
    if (keys.length === 0) return;
    // idは「年月::車番::列::種類」で組み立てているので、まとめ消しはidで引ける。
    const ids = keys.map((key) => `${yearMonth}::${plIssueKey(key)}`);
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      await this.db.delete(plIssueAck).where(inArray(plIssueAck.id, ids.slice(i, i + chunkSize)));
    }
  }
}
