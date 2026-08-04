import { describe, expect, it } from "vitest";
import { GetMonthlyGridUseCase } from "../../src/usecase/steps/getMonthlyGrid";
import type {
  VehiclePlRepository,
  ReviewFlagRepository,
} from "../../src/domain/repositories/VehiclePlRepository";
import type { VehiclePlCalculated } from "../../src/domain/rules/vehiclePlCalculation";

function stubVehiclePlRepo(rows: VehiclePlCalculated[]): VehiclePlRepository {
  return {
    upsertMany: async () => {},
    findByYearMonth: async () => rows,
    findByVehicleNo: async () => rows,
    findByYearMonths: async () => new Map(),
    countByYearMonth: async () => rows.length,
  };
}

function stubReviewFlagRepo(
  flags: Awaited<ReturnType<ReviewFlagRepository["findOpenByYearMonth"]>>,
): ReviewFlagRepository {
  return {
    createFlags: async () => {},
    findOpenByYearMonth: async () => flags,
    resolve: async () => {},
    reopen: async () => {},
  };
}

function baseRow(overrides: Partial<VehiclePlCalculated> = {}): VehiclePlCalculated {
  return {
    no: "1",
    type: "4t",
    depot: "本社",
    reg: "",
    code: "",
    driver: "",
    trips: 0,
    slips: 0,
    hours: 0,
    km: 0,
    fare: 0,
    fee: 0,
    sales: 0,
    toll: 0,
    tollDisc: 0,
    tollNet: 0,
    fuelIn: 0,
    fuelInQty: 0,
    fuelOut: 0,
    fuelOutQty: 0,
    fuelQty: 0,
    nempi: 0,
    adblue: 0,
    fuelTotal: 0,
    repair: 0,
    repairStandard: 0,
    tire: 0,
    equip: 0,
    mainte: 0,
    repairTotal: 0,
    salary: 0,
    bonus: 0,
    welfare: 0,
    laborTotal: 0,
    insCompulsory: 0,
    insVoluntary: 0,
    insTotal: 0,
    taxAuto: 0,
    taxWeight: 0,
    taxTotal: 0,
    miscOther: 0,
    miscTotal: 0,
    lease: 0,
    installment: 0,
    transportTotal: 0,
    adminFee: 0,
    adminTotal: 0,
    fixed: 0,
    variable: 0,
    expense: 0,
    profit: 0,
    margin: 0,
    ...overrides,
  };
}

describe("GetMonthlyGridUseCase", () => {
  it("リポジトリから取得した行をグリッド形式に整形する", async () => {
    const useCase = new GetMonthlyGridUseCase(
      stubVehiclePlRepo([baseRow({ no: "101" })]),
      stubReviewFlagRepo([]),
    );
    const res = await useCase.execute("2026-05");
    expect(res.yearMonth).toBe("2026-05");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.vehicleNo).toBe("101");
    expect(res.isEmpty).toBe(false);
  });

  it("open状態の要確認フラグをハイライト対象フィールドに反映する", async () => {
    const useCase = new GetMonthlyGridUseCase(
      stubVehiclePlRepo([baseRow({ no: "101" })]),
      stubReviewFlagRepo([
        {
          id: "f1",
          vehicleNo: "101",
          field: "fuelIn",
          type: "missing_input",
          severity: "warning",
          message: "未入力です",
          status: "open",
        },
      ]),
    );
    const res = await useCase.execute("2026-05");
    expect(res.rows[0]?.highlightedFields).toContain("fuelIn");
  });

  it("データが無い月は空状態として返す", async () => {
    const useCase = new GetMonthlyGridUseCase(stubVehiclePlRepo([]), stubReviewFlagRepo([]));
    const res = await useCase.execute("2026-06");
    expect(res.isEmpty).toBe(true);
    expect(res.rows).toHaveLength(0);
  });
});
