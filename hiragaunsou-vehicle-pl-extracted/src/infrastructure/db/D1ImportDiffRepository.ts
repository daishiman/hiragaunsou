import { desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { importCompareSnapshot, importDiffAbsorbed, importDiffAck } from "./schema";
import type {
  AbsorbedDiff,
  ComparableRecord,
  ImportDiffTargetKind,
} from "../../domain/rules/importDiffDetection";
import type {
  ImportCompareSnapshotRepository,
  ImportDiffAbsorbedRepository,
  ImportDiffAckRepository,
} from "../../usecase/steps/importDiffAlert";

/** 「前回の写し」の保存先。種類ごとに1行だけ持つ */
export class D1ImportCompareSnapshotRepository implements ImportCompareSnapshotRepository {
  constructor(private readonly db: Db) {}

  async find(targetKind: ImportDiffTargetKind): Promise<ComparableRecord[] | null> {
    const rows = await this.db
      .select()
      .from(importCompareSnapshot)
      .where(eq(importCompareSnapshot.targetKind, targetKind))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.recordsJson);
      return Array.isArray(parsed) ? (parsed as ComparableRecord[]) : null;
    } catch {
      // 写しが壊れているときは「前回が無い」と同じ扱い。
      // 壊れた写しと比べて出る差分は嘘なので、出さないほうがまだ良い。
      return null;
    }
  }

  async save(targetKind: ImportDiffTargetKind, records: readonly ComparableRecord[]): Promise<void> {
    await this.db
      .insert(importCompareSnapshot)
      .values({
        targetKind,
        recordsJson: JSON.stringify(records),
        capturedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: importCompareSnapshot.targetKind,
        set: {
          recordsJson: JSON.stringify(records),
          capturedAt: new Date(),
        },
      });
  }
}

/** 「確認済み」にした指摘の保存先 */
export class D1ImportDiffAckRepository implements ImportDiffAckRepository {
  constructor(private readonly db: Db) {}

  async listFingerprints(): Promise<string[]> {
    const rows = await this.db
      .select({ fingerprint: importDiffAck.fingerprint })
      .from(importDiffAck);
    return rows.map((r) => r.fingerprint);
  }

  async ack(input: {
    fingerprint: string;
    targetKind: string;
    targetLabel: string;
    summary: string;
    actor: { id: string | null; name: string };
  }): Promise<void> {
    await this.db
      .insert(importDiffAck)
      .values({
        fingerprint: input.fingerprint,
        targetKind: input.targetKind,
        targetLabel: input.targetLabel,
        summary: input.summary,
        ackedBy: input.actor.id,
        ackedByName: input.actor.name,
        ackedAt: new Date(),
      })
      // 2回押しても壊れないようにする。押した人と時刻は新しいほうで上書きする
      .onConflictDoUpdate({
        target: importDiffAck.fingerprint,
        set: {
          ackedBy: input.actor.id,
          ackedByName: input.actor.name,
          ackedAt: new Date(),
        },
      });
  }

  /** 確認済みを取り消して、また出るようにする */
  async unack(fingerprint: string): Promise<void> {
    await this.db.delete(importDiffAck).where(eq(importDiffAck.fingerprint, fingerprint));
  }
}

/** 表記のゆれとして自動で吸収した差分の控え */
export class D1ImportDiffAbsorbedRepository implements ImportDiffAbsorbedRepository {
  constructor(private readonly db: Db) {}

  async record(items: readonly AbsorbedDiff[]): Promise<void> {
    if (items.length === 0) return;
    const now = new Date();
    for (const item of items) {
      await this.db.insert(importDiffAbsorbed).values({
        id: crypto.randomUUID(),
        targetKind: item.targetKind,
        targetKey: item.targetKey,
        targetLabel: item.targetLabel,
        field: item.field,
        beforeValue: item.before,
        afterValue: item.after,
        absorbedAt: now,
      });
    }
  }

  async list(limit: number): Promise<(AbsorbedDiff & { absorbedAt: number })[]> {
    const rows = await this.db
      .select()
      .from(importDiffAbsorbed)
      .orderBy(desc(importDiffAbsorbed.absorbedAt))
      .limit(limit);
    return rows.map((r) => ({
      targetKind: r.targetKind as ImportDiffTargetKind,
      targetKey: r.targetKey,
      targetLabel: r.targetLabel,
      field: r.field,
      before: r.beforeValue,
      after: r.afterValue,
      absorbedAt: r.absorbedAt.getTime(),
    }));
  }
}
