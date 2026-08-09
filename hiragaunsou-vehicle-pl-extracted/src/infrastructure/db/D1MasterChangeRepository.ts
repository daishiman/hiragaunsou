import { count, desc, eq, sql, sum } from "drizzle-orm";
import type { Db } from "./client";
import { confirmedMonthApplyLog, masterEditHistory, vehiclePl } from "./schema";
import type { MonthConfirmationState, MasterEditRecord, MasterEditTargetKind } from "../../domain/rules/masterChangeImpact";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";
import type {
  ConfirmedMonthApplyRecord,
  MasterChangeHistoryRepository,
  MasterEditInput,
} from "../../usecase/steps/applyMasterChange";

/**
 * マスタの直しの履歴と、確定済み月への反映記録の保存先 (D1)。
 *
 * 月ごとの確定状況もここから引く。VehiclePlRepository のインターフェースには足さない。
 * あれはテスト用スタブを含めて実装が複数あり、この画面だけが必要とするメソッドを
 * 載せると全実装がこの画面の都合を背負う (listRates を D1 実装だけに置いたのと同じ判断)。
 */
export class D1MasterChangeRepository implements MasterChangeHistoryRepository {
  constructor(private readonly db: Db) {}

  /**
   * 収支表がある月と、その確定状況を1クエリで返す。
   *
   * 「確定済みかどうか」は行ごとの confirmed を数えて決める。月単位のフラグは存在せず、
   * 確定操作(setConfirmed)が月内の全行をまとめて更新しているだけなので、
   * 全行ぶん確定していて初めて確定済みとみなす (isMonthClosed が判定する)。
   */
  async listMonthlyConfirmations(): Promise<MonthConfirmationState[]> {
    const rows = await this.db
      .select({
        yearMonth: vehiclePl.yearMonth,
        total: count(),
        confirmed: sum(vehiclePl.confirmed),
      })
      .from(vehiclePl)
      .groupBy(vehiclePl.yearMonth);

    return rows
      .map((r) => ({
        yearMonth: r.yearMonth,
        total: Number(r.total ?? 0),
        confirmed: Number(r.confirmed ?? 0),
      }))
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  }

  async recordEdits(
    edits: readonly MasterEditInput[],
    actor: { id: string | null; name: string },
  ): Promise<void> {
    if (edits.length === 0) return;
    const now = new Date();
    for (const edit of edits) {
      await this.db.insert(masterEditHistory).values({
        id: crypto.randomUUID(),
        targetKind: edit.targetKind,
        targetKey: edit.targetKey,
        targetLabel: edit.targetLabel,
        field: edit.field,
        fieldLabel: edit.fieldLabel,
        beforeValue: edit.beforeValue,
        afterValue: edit.afterValue,
        editedBy: actor.id,
        editedByName: actor.name,
        editedAt: now,
      });
    }
  }

  async listEdits(limit: number): Promise<MasterEditRecord[]> {
    const rows = await this.db
      .select()
      .from(masterEditHistory)
      .orderBy(desc(masterEditHistory.editedAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      targetKind: r.targetKind as MasterEditTargetKind,
      targetKey: r.targetKey,
      targetLabel: r.targetLabel,
      field: r.field,
      fieldLabel: r.fieldLabel,
      beforeValue: r.beforeValue,
      afterValue: r.afterValue,
      editedByName: r.editedByName,
      editedAt: r.editedAt.getTime(),
      undoneAt: r.undoneAt ? r.undoneAt.getTime() : null,
    }));
  }

  async findEdit(id: string): Promise<MasterEditRecord | null> {
    const rows = await this.db
      .select()
      .from(masterEditHistory)
      .where(eq(masterEditHistory.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      targetKind: r.targetKind as MasterEditTargetKind,
      targetKey: r.targetKey,
      targetLabel: r.targetLabel,
      field: r.field,
      fieldLabel: r.fieldLabel,
      beforeValue: r.beforeValue,
      afterValue: r.afterValue,
      editedByName: r.editedByName,
      editedAt: r.editedAt.getTime(),
      undoneAt: r.undoneAt ? r.undoneAt.getTime() : null,
    };
  }

  async markEditUndone(id: string, actorId: string | null): Promise<void> {
    await this.db
      .update(masterEditHistory)
      .set({ undoneAt: new Date(), undoneBy: actorId })
      .where(eq(masterEditHistory.id, id));
  }

  async recordApply(input: {
    yearMonth: string;
    summary: string;
    snapshot: readonly VehiclePlCalculated[];
    actor: { id: string | null; name: string };
  }): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.insert(confirmedMonthApplyLog).values({
      id,
      yearMonth: input.yearMonth,
      summary: input.summary,
      snapshotJson: JSON.stringify(input.snapshot),
      appliedBy: input.actor.id,
      appliedByName: input.actor.name,
      appliedAt: new Date(),
    });
    return id;
  }

  async listApplies(limit: number): Promise<ConfirmedMonthApplyRecord[]> {
    // snapshot_json は月まるごとの収支表で重い。一覧では読まない。
    const rows = await this.db
      .select({
        id: confirmedMonthApplyLog.id,
        yearMonth: confirmedMonthApplyLog.yearMonth,
        summary: confirmedMonthApplyLog.summary,
        appliedByName: confirmedMonthApplyLog.appliedByName,
        appliedAt: confirmedMonthApplyLog.appliedAt,
        revertedAt: confirmedMonthApplyLog.revertedAt,
      })
      .from(confirmedMonthApplyLog)
      .orderBy(desc(confirmedMonthApplyLog.appliedAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      yearMonth: r.yearMonth,
      summary: r.summary,
      appliedByName: r.appliedByName,
      appliedAt: r.appliedAt.getTime(),
      revertedAt: r.revertedAt ? r.revertedAt.getTime() : null,
    }));
  }

  async findApplySnapshot(
    id: string,
  ): Promise<{ yearMonth: string; snapshot: VehiclePlCalculated[]; revertedAt: number | null } | null> {
    const rows = await this.db
      .select()
      .from(confirmedMonthApplyLog)
      .where(eq(confirmedMonthApplyLog.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;

    let snapshot: VehiclePlCalculated[] = [];
    try {
      const parsed = JSON.parse(r.snapshotJson);
      if (Array.isArray(parsed)) snapshot = parsed as VehiclePlCalculated[];
    } catch {
      // 壊れた記録から書き戻すと、収支表がもっと分からない状態になる。
      // 空で返して呼び出し側に「戻せない」と言わせる。
      snapshot = [];
    }

    return {
      yearMonth: r.yearMonth,
      snapshot,
      revertedAt: r.revertedAt ? r.revertedAt.getTime() : null,
    };
  }

  async markApplyReverted(id: string, actorId: string | null): Promise<void> {
    await this.db
      .update(confirmedMonthApplyLog)
      .set({ revertedAt: new Date(), revertedBy: actorId })
      .where(eq(confirmedMonthApplyLog.id, id));
  }
}

/** 未使用の import を避けるための参照 (drizzle の sql ヘルパは将来の集計で使う) */
void sql;
