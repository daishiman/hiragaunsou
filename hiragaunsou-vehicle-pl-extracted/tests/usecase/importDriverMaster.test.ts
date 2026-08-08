import { describe, expect, it } from "vitest";
import type { AuditLogRecord, AuditLogRepository } from "../../src/domain/repositories/AuditLogRepository";
import type {
  DriverMasterUpsertInput,
  VehicleMasterRecord,
  VehicleMasterRepository,
} from "../../src/domain/repositories/MasterRepository";
import {
  ConfirmImportDriverMasterUseCase,
  IMPORT_DRIVER_MASTER_ACTION,
} from "../../src/usecase/steps/importDriverMaster";

function fakeDriverRepo(existingCodes: string[] = []) {
  const stored = new Map(existingCodes.map((code) => [code, code]));
  const saved: DriverMasterUpsertInput[][] = [];
  return {
    saved,
    async findAll() {
      return [];
    },
    async upsertMany(records: DriverMasterUpsertInput[]) {
      saved.push([...records]);
      let inserted = 0;
      let updated = 0;
      for (const record of records) {
        if (stored.has(record.employeeCode)) updated++;
        else inserted++;
        stored.set(record.employeeCode, record.employeeCode);
      }
      return { inserted, updated };
    },
  };
}

function fakeVehicleRepo(vehicleNos: string[]): VehicleMasterRepository {
  return {
    async findAllActive() {
      return vehicleNos.map((vehicleNo) => ({ vehicleNo }) as VehicleMasterRecord);
    },
    async upsertMany() {
      return { inserted: 0, updated: 0 };
    },
    async updateLeaseInstallment() {},
  };
}

function fakeAuditLog(): AuditLogRepository & { entries: AuditLogRecord[] } {
  const entries: AuditLogRecord[] = [];
  return {
    entries,
    async record(entry) {
      entries.push(entry);
    },
    async findRecent() {
      return [];
    },
  } as AuditLogRepository & { entries: AuditLogRecord[] };
}

const actor = { actorId: "u-1", actorName: "管理者" };

describe("ConfirmImportDriverMasterUseCase", () => {
  it("新規と更新の内訳を返し、誰がいつ変えたかを監査ログに残す", async () => {
    const driverRepo = fakeDriverRepo(["1001"]);
    const auditLog = fakeAuditLog();

    const result = await new ConfirmImportDriverMasterUseCase(
      driverRepo,
      fakeVehicleRepo(["24", "300"]),
      auditLog,
    ).execute({
      ...actor,
      records: [
        { employeeCode: "1001", driverName: "山田太郎", vehicleNo: "24" },
        { employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "300" },
      ],
    });

    expect(result).toMatchObject({ inserted: 1, updated: 1, skipped: [] });
    expect(auditLog.entries[0]).toMatchObject({ action: IMPORT_DRIVER_MASTER_ACTION });
  });

  /**
   * 車番は車両マスタへの外部キー。存在しない車番を混ぜるとD1が取込全体を拒否するため、
   * 1行の綴り違いで全件やり直しにならないよう該当行だけを外す。
   * 外したことを黙っていると「登録したのに給与が乗らない」という追いにくい形になるので必ず返す。
   */
  it("車両マスタに無い車番の行だけを外し、外した理由を返す", async () => {
    const driverRepo = fakeDriverRepo();

    const result = await new ConfirmImportDriverMasterUseCase(
      driverRepo,
      fakeVehicleRepo(["24"]),
      fakeAuditLog(),
    ).execute({
      ...actor,
      records: [
        { employeeCode: "1001", driverName: "山田太郎", vehicleNo: "24" },
        { employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "999" },
      ],
    });

    expect(driverRepo.saved[0]?.map((r) => r.employeeCode)).toEqual(["1001"]);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toEqual([
      {
        employeeCode: "1002",
        driverName: "鈴木一郎",
        vehicleNo: "999",
        reason: "車番「999」が車両マスタにありません。先に車両マスタへ登録してください。",
      },
    ]);
  });

  it("車番が未割当の運転者は車両マスタと突き合わせずに登録する", async () => {
    const driverRepo = fakeDriverRepo();

    const result = await new ConfirmImportDriverMasterUseCase(
      driverRepo,
      fakeVehicleRepo([]),
      fakeAuditLog(),
    ).execute({
      ...actor,
      records: [{ employeeCode: "1001", driverName: "山田太郎", vehicleNo: null }],
    });

    expect(result).toMatchObject({ inserted: 1, skipped: [] });
  });

  it("全行の車番が車両マスタに無ければ、先に車両マスタを登録するよう促して止まる", async () => {
    await expect(
      new ConfirmImportDriverMasterUseCase(
        fakeDriverRepo(),
        fakeVehicleRepo([]),
        fakeAuditLog(),
      ).execute({
        ...actor,
        records: [{ employeeCode: "1001", driverName: "山田太郎", vehicleNo: "24" }],
      }),
    ).rejects.toThrow(/先に車両マスタを登録/);
  });

  it("空のCSVは取込として成立しないので弾く", async () => {
    await expect(
      new ConfirmImportDriverMasterUseCase(
        fakeDriverRepo(),
        fakeVehicleRepo([]),
        fakeAuditLog(),
      ).execute({ ...actor, records: [] }),
    ).rejects.toThrow(/1件もありません/);
  });
});
