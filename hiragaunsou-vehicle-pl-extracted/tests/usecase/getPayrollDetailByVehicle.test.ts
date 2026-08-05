import { describe, expect, it } from "vitest";
import { GetPayrollDetailByVehicleUseCase } from "../../src/usecase/steps/getPayrollDetailByVehicle";
import type { ImportBatchRepository } from "../../src/domain/repositories/VehiclePlRepository";
import type {
  VehicleMasterRepository,
  VehicleMasterRecord,
  DriverMasterRepository,
  DriverMasterRecord,
} from "../../src/domain/repositories/MasterRepository";
import type { PayrollRecord } from "../../src/infrastructure/parsers/payrollParser";

function stubImportBatchRepo(
  payroll: { naturalKey: string; raw: PayrollRecord }[],
): ImportBatchRepository {
  return {
    createBatch: async () => {},
    saveRawIngestion: async () => {},
    findRawRows: async () => payroll.map((r) => ({ naturalKey: r.naturalKey, raw: r.raw, flags: [] })),
  };
}

function stubVehicleMasterRepo(vehicles: VehicleMasterRecord[]): VehicleMasterRepository {
  return { findAllActive: async () => vehicles };
}

function stubDriverMasterRepo(drivers: DriverMasterRecord[]): DriverMasterRepository {
  return { findAll: async () => drivers };
}

function baseVehicle(overrides: Partial<VehicleMasterRecord> = {}): VehicleMasterRecord {
  return {
    vehicleNo: "101",
    vehicleType: "4t",
    depot: "本社",
    regDate: null,
    costCategory: "medium",
    insCompulsory: 1000,
    insVoluntary: 2000,
    taxAuto: 500,
    taxWeight: 300,
    lease: 0,
    installment: 0,
    ...overrides,
  };
}

describe("GetPayrollDetailByVehicleUseCase", () => {
  it("社員コード→運転者マスタ→車両の連鎖で給与を車両単位に集約し、車番順に返す", async () => {
    const importBatchRepo = stubImportBatchRepo([
      { naturalKey: "E1", raw: { employeeCode: "E1", employeeName: "山田", totalPay: 300000, socialInsuranceTotal: 40000 } },
      { naturalKey: "E2", raw: { employeeCode: "E2", employeeName: "鈴木", totalPay: 280000, socialInsuranceTotal: 38000 } },
    ]);
    const vehicleMasterRepo = stubVehicleMasterRepo([
      baseVehicle({ vehicleNo: "101" }),
      baseVehicle({ vehicleNo: "102" }),
    ]);
    const driverMasterRepo = stubDriverMasterRepo([
      { employeeCode: "E1", driverName: "山田太郎", vehicleNo: "101" },
      { employeeCode: "E2", driverName: "鈴木一郎", vehicleNo: "102" },
    ]);

    const usecase = new GetPayrollDetailByVehicleUseCase(importBatchRepo, vehicleMasterRepo, driverMasterRepo);
    const rows = await usecase.execute("2026-07");

    expect(rows).toEqual([
      { vehicleNo: "101", vehicleType: "4t", depot: "本社", driverName: "山田太郎", driverCount: 1, salary: 300000, welfare: 40000 },
      { vehicleNo: "102", vehicleType: "4t", depot: "本社", driverName: "鈴木一郎", driverCount: 1, salary: 280000, welfare: 38000 },
    ]);
  });

  it("運転者が割り当てられていない車両は0円の行として含める(取り漏れに気づけるように)", async () => {
    const importBatchRepo = stubImportBatchRepo([]);
    const vehicleMasterRepo = stubVehicleMasterRepo([baseVehicle({ vehicleNo: "201" })]);
    const driverMasterRepo = stubDriverMasterRepo([]);

    const usecase = new GetPayrollDetailByVehicleUseCase(importBatchRepo, vehicleMasterRepo, driverMasterRepo);
    const rows = await usecase.execute("2026-07");

    expect(rows).toEqual([
      { vehicleNo: "201", vehicleType: "4t", depot: "本社", driverName: null, driverCount: 0, salary: 0, welfare: 0 },
    ]);
  });

  it("2人乗務の車両は給与・社保を合算し、運転者名を/区切りで連結する", async () => {
    const importBatchRepo = stubImportBatchRepo([
      { naturalKey: "E1", raw: { employeeCode: "E1", employeeName: "山田", totalPay: 300000, socialInsuranceTotal: 40000 } },
      { naturalKey: "E2", raw: { employeeCode: "E2", employeeName: "鈴木", totalPay: 280000, socialInsuranceTotal: 38000 } },
    ]);
    const vehicleMasterRepo = stubVehicleMasterRepo([baseVehicle({ vehicleNo: "101" })]);
    const driverMasterRepo = stubDriverMasterRepo([
      { employeeCode: "E1", driverName: "山田太郎", vehicleNo: "101" },
      { employeeCode: "E2", driverName: "鈴木一郎", vehicleNo: "101" },
    ]);

    const usecase = new GetPayrollDetailByVehicleUseCase(importBatchRepo, vehicleMasterRepo, driverMasterRepo);
    const rows = await usecase.execute("2026-07");

    expect(rows).toEqual([
      {
        vehicleNo: "101",
        vehicleType: "4t",
        depot: "本社",
        driverName: "山田太郎/鈴木一郎",
        driverCount: 2,
        salary: 580000,
        welfare: 78000,
      },
    ]);
  });
});
