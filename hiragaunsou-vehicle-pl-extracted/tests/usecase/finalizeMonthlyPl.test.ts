import { describe, expect, it } from "vitest";
import { FinalizeMonthlyPlUseCase } from "../../src/usecase/steps/finalizeMonthlyPl";
import type { ImportBatchRepository, VehiclePlRepository } from "../../src/domain/repositories/VehiclePlRepository";
import type {
  VehicleMasterRepository,
  VehicleMasterRecord,
  DriverMasterRepository,
  DriverMasterRecord,
  RateMasterRepository,
} from "../../src/domain/repositories/MasterRepository";
import { DEFAULT_RATE_SETTINGS } from "../../src/domain/rules/vehiclePlCalculation";
import { DEFAULT_DEFICIT_THRESHOLDS } from "../../src/domain/rules/deficitClassification";
import type { VehicleOperationRecord } from "../../src/infrastructure/parsers/vehicleOperationParser";
import type { SalesMonitorRow } from "../../src/infrastructure/parsers/salesMonitorParser";
import type { PayrollRecord } from "../../src/infrastructure/parsers/payrollParser";

function stubImportBatchRepo(raw: {
  vehicle_operation: { naturalKey: string; raw: VehicleOperationRecord }[];
  sales_monitor: { naturalKey: string; raw: SalesMonitorRow }[];
  payroll: { naturalKey: string; raw: PayrollRecord }[];
}): ImportBatchRepository {
  return {
    createBatch: async () => {},
    saveRawIngestion: async () => {},
    findRawRows: async (_yearMonth, sourceType) => {
      const rows = raw[sourceType as keyof typeof raw] ?? [];
      return rows.map((r) => ({ naturalKey: r.naturalKey, raw: r.raw, flags: [] }));
    },
  };
}

function stubVehicleMasterRepo(vehicles: VehicleMasterRecord[]): VehicleMasterRepository {
  return { findAllActive: async () => vehicles };
}

function stubDriverMasterRepo(drivers: DriverMasterRecord[]): DriverMasterRepository {
  return { findAll: async () => drivers };
}

function stubRateMasterRepo(): RateMasterRepository {
  return {
    getRates: async () => DEFAULT_RATE_SETTINGS,
    getDeficitThresholds: async () => DEFAULT_DEFICIT_THRESHOLDS,
    setRate: async () => {},
  };
}

function stubVehiclePlRepo() {
  const calls: { yearMonth: string; rows: unknown[] }[] = [];
  const repo: VehiclePlRepository = {
    upsertMany: async (yearMonth, rows) => {
      calls.push({ yearMonth, rows });
    },
    findByYearMonth: async () => [],
    findByVehicleNo: async () => [],
    findByYearMonths: async () => new Map(),
    countByYearMonth: async () => 0,
  };
  return { repo, calls };
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

describe("FinalizeMonthlyPlUseCase", () => {
  it("車両マスタを起点に運行実績・売上・給与を突合し、収支表を計算してupsertする", async () => {
    const importBatchRepo = stubImportBatchRepo({
      vehicle_operation: [
        {
          naturalKey: "101",
          raw: {
            vehicleCode: "101",
            vehicleName: "V1",
            depot: "本社",
            vehicleType: "4t",
            tripCount: 20,
            operatingHours: 174.98,
            totalDistanceKm: 6617.98,
            totalFuelQtyLiter: 100,
            fuelEconomy: 10,
            isChartered: false,
          },
        },
      ],
      sales_monitor: [
        {
          naturalKey: "101",
          raw: {
            vehicleCode: "101",
            driverName: "山田",
            fare: 500000,
            toll: 10000,
            ancillaryFee: 5000,
            isChartered: false,
            needsReview: false,
            reviewReason: null,
          },
        },
      ],
      payroll: [
        {
          naturalKey: "93",
          raw: { employeeCode: "93", employeeName: "山田太郎", totalPay: 300000, socialInsuranceTotal: 40000 },
        },
      ],
    });
    const vehicleMasterRepo = stubVehicleMasterRepo([baseVehicle()]);
    const driverMasterRepo = stubDriverMasterRepo([
      { employeeCode: "93", driverName: "山田太郎", vehicleNo: "101" },
    ]);
    const rateMasterRepo = stubRateMasterRepo();
    const { repo: vehiclePlRepo, calls } = stubVehiclePlRepo();

    const useCase = new FinalizeMonthlyPlUseCase(
      importBatchRepo,
      vehicleMasterRepo,
      driverMasterRepo,
      rateMasterRepo,
      vehiclePlRepo,
    );

    const result = await useCase.execute({
      yearMonth: "2026-05",
      manualInputs: [
        {
          vehicleNo: "101",
          fuelInQty: 50,
          fuelOut: 8000,
          fuelOutQty: 50,
          adblue: 500,
          repairActual: 1000,
          equip: 200,
          mainte: 300,
          miscOther: 100,
        },
      ],
    });

    expect(result.vehicleCount).toBe(1);
    const row = result.rows[0];
    expect(row?.no).toBe("101");
    expect(row?.driver).toBe("山田太郎");
    expect(row?.salary).toBe(300000);
    expect(row?.welfare).toBe(40000);
    expect(row?.trips).toBe(20);
    expect(row?.fare).toBe(500000);
    expect(row?.sales).toBe(505000); // fare + fee(ancillaryFee)
    expect(row?.tollDisc).toBeCloseTo(10000 * 0.356);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.yearMonth).toBe("2026-05");
    expect(calls[0]?.rows).toHaveLength(1);
  });

  it("運行実績・売上・給与が未取込の車両もマスタ起点で0埋めして収支表に含める", async () => {
    const importBatchRepo = stubImportBatchRepo({
      vehicle_operation: [],
      sales_monitor: [],
      payroll: [],
    });
    const vehicleMasterRepo = stubVehicleMasterRepo([baseVehicle({ vehicleNo: "202" })]);
    const driverMasterRepo = stubDriverMasterRepo([]);
    const rateMasterRepo = stubRateMasterRepo();
    const { repo: vehiclePlRepo } = stubVehiclePlRepo();

    const useCase = new FinalizeMonthlyPlUseCase(
      importBatchRepo,
      vehicleMasterRepo,
      driverMasterRepo,
      rateMasterRepo,
      vehiclePlRepo,
    );

    const result = await useCase.execute({ yearMonth: "2026-05", manualInputs: [] });

    expect(result.vehicleCount).toBe(1);
    expect(result.rows[0]?.no).toBe("202");
    expect(result.rows[0]?.sales).toBe(0);
    // 固定費(保険・税)はマスタから即時セットされるため、売上0でも損益は赤字になる(仕様通り)
    expect(result.rows[0]?.profit).toBeLessThan(0);
  });
});
