import { describe, expect, it } from "vitest";
import type { AuditLogEntry, AuditLogRecord, AuditLogRepository } from "../../src/domain/repositories/AuditLogRepository";
import {
  DeleteImportBatchUseCase,
  DELETE_IMPORT_BATCH_ACTION,
  ListImportBatchDeletionLogUseCase,
  ListImportBatchesUseCase,
} from "../../src/usecase/steps/manageImportBatches";

type FakeBatch = {
  id: string;
  sourceType: string;
  yearMonth: string;
  fileName: string;
  rowCount: number;
  excludedRowCount: number;
  status: string;
  importedAt: number;
  importedByName: string | null;
};

function fakeImportBatchRepo(batches: FakeBatch[]) {
  const deletedCalls: { yearMonth: string; sourceType: string; batchIds: string[] }[] = [];
  return {
    deletedCalls,
    async listAll() {
      return batches;
    },
    async findById(id: string) {
      const b = batches.find((x) => x.id === id);
      if (!b) return null;
      return { id: b.id, sourceType: b.sourceType, yearMonth: b.yearMonth, fileName: b.fileName, rowCount: b.rowCount };
    },
    async deleteBatches(yearMonth: string, sourceType: string, batchIds: string[]) {
      deletedCalls.push({ yearMonth, sourceType, batchIds });
      const before = batches.length;
      const remaining = batches.filter((b) => !batchIds.includes(b.id));
      batches.length = 0;
      batches.push(...remaining);
      return before - remaining.length;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fakeAuditLogRepo(): AuditLogRepository & { rows: AuditLogRecord[] } {
  const rows: AuditLogRecord[] = [];
  let seq = 0;
  return {
    rows,
    async record(entry: AuditLogEntry) {
      rows.unshift({
        id: `log-${seq++}`,
        actorId: entry.actorId,
        actorName: entry.actorName,
        action: entry.action,
        summary: entry.summary,
        detail: entry.detail ?? null,
        createdAt: seq,
      });
    },
    async listRecent(action: string, limit: number) {
      return rows.filter((r) => r.action === action).slice(0, limit);
    },
  };
}

describe("ListImportBatchesUseCase", () => {
  it("リポジトリの一覧をそのまま返す", async () => {
    const repo = fakeImportBatchRepo([
      {
        id: "b1",
        sourceType: "sales_monitor",
        yearMonth: "2026-08",
        fileName: "test.csv",
        rowCount: 10,
        excludedRowCount: 0,
        status: "completed",
        importedAt: 100,
        importedByName: "山田",
      },
    ]);
    const usecase = new ListImportBatchesUseCase(repo);
    const result = await usecase.execute();
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("b1");
  });
});

describe("DeleteImportBatchUseCase", () => {
  it("対象バッチをyearMonth+sourceTypeで絞ってdeleteBatchesへ渡し、監査ログを記録する", async () => {
    const repo = fakeImportBatchRepo([
      {
        id: "b1",
        sourceType: "sales_monitor",
        yearMonth: "2026-08",
        fileName: "sample-may-data.csv",
        rowCount: 42,
        excludedRowCount: 0,
        status: "completed",
        importedAt: 100,
        importedByName: "山田",
      },
    ]);
    const auditLog = fakeAuditLogRepo();
    const usecase = new DeleteImportBatchUseCase(repo, auditLog);

    await usecase.execute({ actorId: "admin-1", actorName: "管理者太郎", batchId: "b1" });

    expect(repo.deletedCalls).toEqual([
      { yearMonth: "2026-08", sourceType: "sales_monitor", batchIds: ["b1"] },
    ]);
    expect(auditLog.rows).toHaveLength(1);
    expect(auditLog.rows[0]?.action).toBe(DELETE_IMPORT_BATCH_ACTION);
    expect(auditLog.rows[0]?.actorName).toBe("管理者太郎");
    expect(auditLog.rows[0]?.summary).toContain("2026-08");
    expect(auditLog.rows[0]?.summary).toContain("売上モニタリスト");
    expect(auditLog.rows[0]?.summary).toContain("sample-may-data.csv");
    expect(auditLog.rows[0]?.summary).toContain("42件");
  });

  it("存在しないバッチIDはエラーになり、監査ログも記録されない", async () => {
    const repo = fakeImportBatchRepo([]);
    const auditLog = fakeAuditLogRepo();
    const usecase = new DeleteImportBatchUseCase(repo, auditLog);

    await expect(
      usecase.execute({ actorId: "admin-1", actorName: "管理者太郎", batchId: "missing" }),
    ).rejects.toThrow("見つかりません");
    expect(auditLog.rows).toHaveLength(0);
  });
});

describe("ListImportBatchDeletionLogUseCase", () => {
  it("delete_import_batchアクションのログのみを新しい順に返す", async () => {
    const auditLog = fakeAuditLogRepo();
    await auditLog.record({ actorId: "a1", actorName: "A", action: DELETE_IMPORT_BATCH_ACTION, summary: "1件目" });
    await auditLog.record({ actorId: "a1", actorName: "A", action: "other_action", summary: "対象外" });
    await auditLog.record({ actorId: "a1", actorName: "A", action: DELETE_IMPORT_BATCH_ACTION, summary: "2件目" });

    const usecase = new ListImportBatchDeletionLogUseCase(auditLog);
    const result = await usecase.execute();
    expect(result.map((r) => r.summary)).toEqual(["2件目", "1件目"]);
  });
});
