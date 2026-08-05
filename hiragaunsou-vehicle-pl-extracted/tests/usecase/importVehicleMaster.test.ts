import { describe, expect, it } from "vitest";
import type {
  AuditLogEntry,
  AuditLogRecord,
  AuditLogRepository,
} from "../../src/domain/repositories/AuditLogRepository";
import type { VehicleMasterUpsertInput } from "../../src/domain/repositories/MasterRepository";
import {
  ConfirmImportVehicleMasterUseCase,
  IMPORT_VEHICLE_MASTER_ACTION,
} from "../../src/usecase/steps/importVehicleMaster";

function makeRecord(vehicleNo: string): VehicleMasterUpsertInput {
  return {
    vehicleNo,
    vehicleType: "大型ウイング",
    depot: "本社",
    costCategory: "large",
    insCompulsory: 1530,
    insVoluntary: 12000,
    taxAuto: 50400,
    taxWeight: 10400,
    lease: 85000,
    installment: 0,
  };
}

/** 既存車番をインメモリで持ち、upsertMany の新規/更新内訳をD1と同じ基準で返すfake。 */
function fakeVehicleMasterRepo(existingNos: string[]) {
  const stored = new Map(existingNos.map((no) => [no, makeRecord(no)]));
  return {
    stored,
    async findAllActive() {
      return [...stored.values()];
    },
    async updateLeaseInstallment() {},
    async upsertMany(records: VehicleMasterUpsertInput[]) {
      let inserted = 0;
      let updated = 0;
      for (const record of records) {
        if (stored.has(record.vehicleNo)) updated++;
        else inserted++;
        stored.set(record.vehicleNo, record);
      }
      return { inserted, updated };
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

describe("ConfirmImportVehicleMasterUseCase", () => {
  it("既存車番は更新・未登録の車番は新規として件数を返す", async () => {
    const repo = fakeVehicleMasterRepo(["1111", "2222"]);
    const usecase = new ConfirmImportVehicleMasterUseCase(repo, fakeAuditLogRepo());

    const result = await usecase.execute({
      actorId: "admin-1",
      actorName: "管理者太郎",
      records: [makeRecord("1111"), makeRecord("2222"), makeRecord("3333")],
    });

    expect(result).toEqual({ inserted: 1, updated: 2 });
    expect(repo.stored.size).toBe(3);
  });

  it("誰が何件取り込んだかを監査ログに残す", async () => {
    const repo = fakeVehicleMasterRepo(["1111"]);
    const auditLog = fakeAuditLogRepo();
    const usecase = new ConfirmImportVehicleMasterUseCase(repo, auditLog);

    await usecase.execute({
      actorId: "admin-1",
      actorName: "管理者太郎",
      records: [makeRecord("1111"), makeRecord("3333")],
    });

    expect(auditLog.rows).toHaveLength(1);
    expect(auditLog.rows[0]?.action).toBe(IMPORT_VEHICLE_MASTER_ACTION);
    expect(auditLog.rows[0]?.actorName).toBe("管理者太郎");
    expect(auditLog.rows[0]?.summary).toContain("2件");
    expect(auditLog.rows[0]?.summary).toContain("新規1件");
    expect(auditLog.rows[0]?.summary).toContain("更新1件");
    expect(auditLog.rows[0]?.detail).toMatchObject({
      total: 2,
      inserted: 1,
      updated: 1,
      vehicleNos: ["1111", "3333"],
    });
  });

  it("0件の取込はエラーになり、マスタも監査ログも触らない", async () => {
    const repo = fakeVehicleMasterRepo(["1111"]);
    const auditLog = fakeAuditLogRepo();
    const usecase = new ConfirmImportVehicleMasterUseCase(repo, auditLog);

    await expect(
      usecase.execute({ actorId: "admin-1", actorName: "管理者太郎", records: [] }),
    ).rejects.toThrow("1件もありません");
    expect(repo.stored.size).toBe(1);
    expect(auditLog.rows).toHaveLength(0);
  });
});
