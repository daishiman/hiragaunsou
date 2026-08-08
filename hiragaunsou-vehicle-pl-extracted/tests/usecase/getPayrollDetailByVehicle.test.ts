import { describe, expect, it } from "vitest";
import { GetPayrollDetailByVehicleUseCase } from "../../src/usecase/steps/getPayrollDetailByVehicle";
import type { ImportBatchRepository } from "../../src/domain/repositories/VehiclePlRepository";
import type {
  VehicleMasterRepository,
  VehicleMasterRecord,
  DriverMasterRepository,
  DriverMasterRecord,
} from "../../src/domain/repositories/MasterRepository";
import type {
  VehiclePlOverrideRecord,
  VehiclePlOverrideRepository,
} from "../../src/domain/repositories/VehiclePlOverrideRepository";
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

function stubOverrideRepo(records: VehiclePlOverrideRecord[] = []): VehiclePlOverrideRepository {
  return {
    findByYearMonth: async () => records,
    findOne: async (_ym, vehicleNo) => records.find((r) => r.vehicleNo === vehicleNo) ?? null,
    save: async () => {},
    remove: async () => {},
    countPending: async () => 0,
    markApplied: async () => {},
  };
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

/** 上書きが無い行(取込値がそのまま収支表に載る)の期待値。テストの本題以外を毎回書かずに済ませる。 */
function plainRow(row: {
  vehicleNo: string;
  driverName: string | null;
  driverCount: number;
  salary: number;
  welfare: number;
  payrollMatchedCount: number;
}) {
  return {
    vehicleNo: row.vehicleNo,
    vehicleType: "4t",
    depot: "本社",
    driverName: row.driverName,
    driverCount: row.driverCount,
    importedSalary: row.salary,
    importedWelfare: row.welfare,
    salary: row.salary,
    welfare: row.welfare,
    salaryOverridden: false,
    welfareOverridden: false,
    overrideValues: {},
    overrideExcluded: false,
    overrideReason: null,
    overrideUpdatedAt: null,
    payrollMatchedCount: row.payrollMatchedCount,
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

    const usecase = new GetPayrollDetailByVehicleUseCase(
      importBatchRepo,
      vehicleMasterRepo,
      driverMasterRepo,
      stubOverrideRepo(),
    );
    const { rows, summary } = await usecase.execute("2026-07");

    expect(rows).toEqual([
      plainRow({ vehicleNo: "101", driverName: "山田太郎", driverCount: 1, salary: 300000, welfare: 40000, payrollMatchedCount: 1 }),
      plainRow({ vehicleNo: "102", driverName: "鈴木一郎", driverCount: 1, salary: 280000, welfare: 38000, payrollMatchedCount: 1 }),
    ]);
    expect(summary).toEqual({
      payrollRowCount: 2,
      driverMasterCount: 2,
      assignedVehicleCount: 2,
      payrollMissingVehicleCount: 0,
    });
  });

  it("運転者が割り当てられていない車両は0円の行として含める(取り漏れに気づけるように)", async () => {
    const importBatchRepo = stubImportBatchRepo([]);
    const vehicleMasterRepo = stubVehicleMasterRepo([baseVehicle({ vehicleNo: "201" })]);
    const driverMasterRepo = stubDriverMasterRepo([]);

    const usecase = new GetPayrollDetailByVehicleUseCase(
      importBatchRepo,
      vehicleMasterRepo,
      driverMasterRepo,
      stubOverrideRepo(),
    );
    const { rows, summary } = await usecase.execute("2026-07");

    expect(rows).toEqual([
      plainRow({ vehicleNo: "201", driverName: null, driverCount: 0, salary: 0, welfare: 0, payrollMatchedCount: 0 }),
    ]);
    // 「運転者マスタが空だから全車0円」であることを、金額ではなく件数で言えるようにする
    expect(summary).toEqual({
      payrollRowCount: 0,
      driverMasterCount: 0,
      assignedVehicleCount: 0,
      payrollMissingVehicleCount: 0,
    });
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

    const usecase = new GetPayrollDetailByVehicleUseCase(
      importBatchRepo,
      vehicleMasterRepo,
      driverMasterRepo,
      stubOverrideRepo(),
    );
    const { rows } = await usecase.execute("2026-07");

    expect(rows).toEqual([
      plainRow({
        vehicleNo: "101",
        driverName: "山田太郎/鈴木一郎",
        driverCount: 2,
        salary: 580000,
        welfare: 78000,
        payrollMatchedCount: 2,
      }),
    ]);
  });

  it("運転者は割り当たっているのに給与集計表に社員Noが無い車両を数える(0円の理由を言い分けるため)", async () => {
    // 給与集計表には E1 しか居ないが、運転者マスタでは 102 に E9 が割り当たっている状態。
    // 102 は「未割当」ではないのに0円になるので、金額だけからは突合ずれだと分からない。
    const importBatchRepo = stubImportBatchRepo([
      { naturalKey: "E1", raw: { employeeCode: "E1", employeeName: "山田", totalPay: 300000, socialInsuranceTotal: 40000 } },
    ]);
    const vehicleMasterRepo = stubVehicleMasterRepo([
      baseVehicle({ vehicleNo: "101" }),
      baseVehicle({ vehicleNo: "102" }),
    ]);
    const driverMasterRepo = stubDriverMasterRepo([
      { employeeCode: "E1", driverName: "山田太郎", vehicleNo: "101" },
      { employeeCode: "E9", driverName: "退職者", vehicleNo: "102" },
    ]);

    const usecase = new GetPayrollDetailByVehicleUseCase(
      importBatchRepo,
      vehicleMasterRepo,
      driverMasterRepo,
      stubOverrideRepo(),
    );
    const { rows, summary } = await usecase.execute("2026-07");

    expect(rows[1]).toMatchObject({ vehicleNo: "102", driverCount: 1, payrollMatchedCount: 0, salary: 0 });
    expect(summary.payrollMissingVehicleCount).toBe(1);
  });

  it("人件費の手修正は取込値と別に返す(どちらの数字を見ているか画面で言い分けられるように)", async () => {
    const importBatchRepo = stubImportBatchRepo([
      { naturalKey: "E1", raw: { employeeCode: "E1", employeeName: "山田", totalPay: 300000, socialInsuranceTotal: 40000 } },
    ]);
    const vehicleMasterRepo = stubVehicleMasterRepo([baseVehicle({ vehicleNo: "101" })]);
    const driverMasterRepo = stubDriverMasterRepo([
      { employeeCode: "E1", driverName: "山田太郎", vehicleNo: "101" },
    ]);
    const updatedAt = new Date("2026-07-10T01:02:03Z");
    const overrideRepo = stubOverrideRepo([
      {
        vehicleNo: "101",
        excluded: false,
        // 走行距離の直しも一緒に持っている。給与だけ直すときも消してはいけない値。
        values: { salary: 250000, km: 8000 },
        reason: "月中に車両を乗り換えたため按分",
        updatedAt,
        updatedByName: "山田",
        appliedAt: null,
      },
    ]);

    const usecase = new GetPayrollDetailByVehicleUseCase(
      importBatchRepo,
      vehicleMasterRepo,
      driverMasterRepo,
      overrideRepo,
    );
    const { rows } = await usecase.execute("2026-07");

    expect(rows[0]).toMatchObject({
      importedSalary: 300000,
      salary: 250000,
      salaryOverridden: true,
      // 社保は直していないので取込値のまま
      importedWelfare: 40000,
      welfare: 40000,
      welfareOverridden: false,
      overrideValues: { salary: 250000, km: 8000 },
      overrideReason: "月中に車両を乗り換えたため按分",
      overrideUpdatedAt: updatedAt.getTime(),
    });
  });
});
