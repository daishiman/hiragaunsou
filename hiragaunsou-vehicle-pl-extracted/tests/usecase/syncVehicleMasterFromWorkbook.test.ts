import { describe, expect, it } from "vitest";
import {
  ImportMonthlyPlWorkbookUseCase,
  SYNC_VEHICLE_MASTER_ACTION,
  buildVehicleMasterRecords,
} from "../../src/usecase/steps/importMonthlyPlWorkbook";
import type { FileStorageRepository, StoredFileRef } from "../../src/domain/repositories/FileStorageRepository";
import type { ImportBatchRepository, VehiclePlRepository } from "../../src/domain/repositories/VehiclePlRepository";
import type { AuditLogEntry, AuditLogRepository } from "../../src/domain/repositories/AuditLogRepository";
import type {
  VehicleMasterRepository,
  VehicleMasterUpsertInput,
} from "../../src/domain/repositories/MasterRepository";
import type { VehiclePlCalculated } from "../../src/domain/rules/vehiclePlCalculation";
import { buildMonthlyPlWorkbookFixture } from "../fixtures/monthlyPlWorkbook";

function row(overrides: Partial<VehiclePlCalculated>): VehiclePlCalculated {
  return {
    no: "1111",
    type: "大型ウイング",
    depot: "本社",
    insCompulsory: 1000,
    insVoluntary: 2000,
    taxAuto: 3000,
    taxWeight: 4000,
    lease: 5000,
    installment: 6000,
    ...overrides,
  } as VehiclePlCalculated;
}

describe("buildVehicleMasterRecords", () => {
  it("収支表の行から車両マスタ相当の9項目を抜き出す", () => {
    const { records, skipped } = buildVehicleMasterRecords([row({})]);

    expect(skipped).toEqual([]);
    expect(records).toEqual([
      {
        vehicleNo: "1111",
        vehicleType: "大型ウイング",
        depot: "本社",
        costCategory: "large",
        insCompulsory: 1000,
        insVoluntary: 2000,
        taxAuto: 3000,
        taxWeight: 4000,
        lease: 5000,
        installment: 6000,
      },
    ]);
  });

  it("車種名から原価カテゴリを判定できない行は更新せず理由付きで返す", () => {
    const { records, skipped } = buildVehicleMasterRecords([
      row({ no: "1111" }),
      row({ no: "6666", type: "特装車" }),
    ]);

    expect(records.map((r) => r.vehicleNo)).toEqual(["1111"]);
    expect(skipped).toEqual([
      { vehicleNo: "6666", vehicleType: "特装車", reason: expect.stringContaining("特装車") },
    ]);
  });

  it("車番が空の集計行は対象外にする", () => {
    const { records, skipped } = buildVehicleMasterRecords([row({ no: "  " }), row({ no: "1111" })]);

    expect(records.map((r) => r.vehicleNo)).toEqual(["1111"]);
    expect(skipped).toEqual([]);
  });

  it("同じ車番が複数行ある場合は後の行を採用する", () => {
    const { records } = buildVehicleMasterRecords([
      row({ no: "1111", lease: 5000 }),
      row({ no: "1111", lease: 9999 }),
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]?.lease).toBe(9999);
  });

  it("車種名の表記ゆれを吸収して原価カテゴリを判定する", () => {
    const { records } = buildVehicleMasterRecords([row({ type: "大型　セミトレーラ" })]);

    expect(records[0]?.costCategory).toBe("semiTrailer");
  });
});

describe("ImportMonthlyPlWorkbookUseCase の車両マスタ自動更新", () => {
  function deps() {
    const fileStorage: FileStorageRepository = {
      save: async (): Promise<StoredFileRef> => ({ key: "k", size: 1, storedAt: 1 }),
      get: async () => null,
    };
    const batchRepo: ImportBatchRepository = {
      createBatch: async () => undefined,
      saveRawIngestion: async () => undefined,
      findRawRows: async () => [],
      findLatestBatch: async () => null,
    };
    const vehiclePlRepo: VehiclePlRepository = {
      upsertMany: async () => undefined,
      findByYearMonth: async () => [],
      findByVehicleNo: async () => [],
      findByYearMonths: async () => new Map(),
      countByYearMonth: async () => 0,
    };
    const upserted: VehicleMasterUpsertInput[][] = [];
    const vehicleMasterRepo = {
      findAllActive: async () => [],
      upsertMany: async (records: VehicleMasterUpsertInput[]) => {
        upserted.push(records);
        return { inserted: records.length, updated: 0 };
      },
      updateLeaseInstallment: async () => undefined,
    } satisfies VehicleMasterRepository;
    const logs: AuditLogEntry[] = [];
    const auditLog: AuditLogRepository = {
      record: async (entry) => { logs.push(entry); },
      listRecent: async () => [],
    };
    return { fileStorage, batchRepo, vehiclePlRepo, vehicleMasterRepo, auditLog, upserted, logs };
  }

  const input = {
    yearMonth: "2026-05",
    fileName: "収支表.xlsx",
    content: buildMonthlyPlWorkbookFixture(),
    importedBy: "user-1",
    importedByName: "管理者A",
  };

  it("収支表の取込に伴い車両マスタを上書き更新する", async () => {
    const d = deps();
    const result = await new ImportMonthlyPlWorkbookUseCase(
      d.fileStorage,
      d.batchRepo,
      d.vehiclePlRepo,
      d.vehicleMasterRepo,
      d.auditLog,
    ).execute(input);

    expect(d.upserted).toHaveLength(1);
    expect(d.upserted[0]).toHaveLength(1);
    expect(d.upserted[0]?.[0]).toMatchObject({ vehicleNo: "10", costCategory: "large" });
    expect(result.vehicleMasterSync).toMatchObject({ inserted: 1, updated: 0, skipped: [] });
  });

  it("自動更新の監査ログを手動CSV取込と区別できるaction名で残す", async () => {
    const d = deps();
    await new ImportMonthlyPlWorkbookUseCase(
      d.fileStorage,
      d.batchRepo,
      d.vehiclePlRepo,
      d.vehicleMasterRepo,
      d.auditLog,
    ).execute(input);

    expect(d.logs).toHaveLength(1);
    expect(d.logs[0]?.action).toBe(SYNC_VEHICLE_MASTER_ACTION);
    expect(SYNC_VEHICLE_MASTER_ACTION).not.toBe("import_vehicle_master");
    expect(d.logs[0]?.actorName).toBe("管理者A");
    expect(d.logs[0]?.summary).toContain("2026-05");
    expect(d.logs[0]?.detail).toMatchObject({ yearMonth: "2026-05", fileName: "収支表.xlsx", inserted: 1 });
  });

  it("車両マスタの連携先が未設定なら従来どおり収支表の取込だけを行う", async () => {
    const d = deps();
    const result = await new ImportMonthlyPlWorkbookUseCase(
      d.fileStorage,
      d.batchRepo,
      d.vehiclePlRepo,
    ).execute(input);

    expect(result.vehicleMasterSync).toBeNull();
    expect(d.upserted).toHaveLength(0);
    expect(d.logs).toHaveLength(0);
  });
});
