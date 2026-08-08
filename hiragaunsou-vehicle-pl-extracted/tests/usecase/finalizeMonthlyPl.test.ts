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
  const removed: { yearMonth: string; vehicleNos: string[] }[] = [];
  const repo: VehiclePlRepository = {
    upsertMany: async (yearMonth, rows) => {
      calls.push({ yearMonth, rows });
    },
    removeVehicles: async (yearMonth, vehicleNos) => {
      removed.push({ yearMonth, vehicleNos: [...vehicleNos] });
    },
    findByYearMonth: async () => [],
    findByVehicleNo: async () => [],
    findByYearMonths: async () => new Map(),
    countByYearMonth: async () => 0,
  };
  return { repo, calls, removed };
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

  // 実データ突合 (2026-05) で判明した業務ルール。現行Excelの「車両別売上」シートは
  // キリンの輸送協力金・経営支援金を収支表 L列「高速他料金」= 売上側に載せている。
  it("キリン配賦は費用の諸経費ではなく売上(附帯料金)に加算する", async () => {
    const importBatchRepo = stubImportBatchRepo({ vehicle_operation: [], sales_monitor: [], payroll: [] });
    const useCase = new FinalizeMonthlyPlUseCase(
      importBatchRepo,
      stubVehicleMasterRepo([baseVehicle({ vehicleNo: "24" })]),
      stubDriverMasterRepo([]),
      stubRateMasterRepo(),
      stubVehiclePlRepo().repo,
    );

    const result = await useCase.execute({
      yearMonth: "2026-05",
      manualInputs: [],
      kirinAllocations: [{ vehicleNo: "24", amount: 152_127 }],
    });

    const row = result.rows[0];
    expect(row?.fee).toBe(152_127);
    expect(row?.sales).toBe(152_127);
    expect(row?.miscOther).toBe(0);
  });

  // 賞与は運転者1人あたりの月額。2人乗務の車両は2人分になる (現行Excelも月5万円で計上)。
  it("賞与は車両に紐づく運転者の人数分を計上する", async () => {
    const importBatchRepo = stubImportBatchRepo({ vehicle_operation: [], sales_monitor: [], payroll: [] });
    const useCase = new FinalizeMonthlyPlUseCase(
      importBatchRepo,
      stubVehicleMasterRepo([baseVehicle({ vehicleNo: "22" }), baseVehicle({ vehicleNo: "23" })]),
      stubDriverMasterRepo([
        { employeeCode: "658", driverName: "濱田", vehicleNo: "22" },
        { employeeCode: "720", driverName: "豊田", vehicleNo: "22" },
        { employeeCode: "611", driverName: "須江", vehicleNo: "23" },
      ]),
      stubRateMasterRepo(),
      stubVehiclePlRepo().repo,
    );

    const result = await useCase.execute({ yearMonth: "2026-05", manualInputs: [] });
    const monthly = DEFAULT_RATE_SETTINGS.bonusAnnual / 12;

    expect(result.rows.find((r) => r.no === "22")?.bonus).toBeCloseTo(monthly * 2);
    expect(result.rows.find((r) => r.no === "23")?.bonus).toBeCloseTo(monthly);
  });

  // 運転者マスタに紐づく運転者が居ない車両は賞与も発生しない
  it("運転者が紐づいていない車両の賞与は0にする", async () => {
    const importBatchRepo = stubImportBatchRepo({ vehicle_operation: [], sales_monitor: [], payroll: [] });
    const useCase = new FinalizeMonthlyPlUseCase(
      importBatchRepo,
      stubVehicleMasterRepo([baseVehicle({ vehicleNo: "205" })]),
      stubDriverMasterRepo([]),
      stubRateMasterRepo(),
      stubVehiclePlRepo().repo,
    );

    const result = await useCase.execute({ yearMonth: "2026-05", manualInputs: [] });
    expect(result.rows[0]?.bonus).toBe(0);
    expect(result.rows[0]?.laborTotal).toBe(0);
  });

  /**
   * 車番10の運賃 1,050,000 → 900,000 のような、請求側の事情による手直し。
   * 上書きは計算の入口にだけ効き、売上・経費計・損益はそこから作り直される。
   */
  it("車両単位の上書きは計算の入口に重ね、下流は必ず計算し直す", async () => {
    const importBatchRepo = stubImportBatchRepo({
      vehicle_operation: [],
      sales_monitor: [
        {
          naturalKey: "10",
          raw: {
            vehicleCode: "10",
            driverName: "山田",
            fare: 1050000,
            toll: 0,
            ancillaryFee: 0,
            isChartered: false,
            needsReview: false,
            reviewReason: null,
          },
        },
      ],
      payroll: [],
    });
    const useCase = new FinalizeMonthlyPlUseCase(
      importBatchRepo,
      stubVehicleMasterRepo([baseVehicle({ vehicleNo: "10" })]),
      stubDriverMasterRepo([]),
      stubRateMasterRepo(),
      stubVehiclePlRepo().repo,
    );

    const result = await useCase.execute({
      yearMonth: "2026-05",
      manualInputs: [],
      overrides: [
        {
          vehicleNo: "10",
          excluded: false,
          values: { fare: 900000 },
          reason: "請求側で15万円減額",
        },
      ],
    });

    const row = result.rows[0];
    expect(row?.fare).toBe(900000);
    expect(row?.sales).toBe(900000);
    // 一般管理費は売上連動。入口を直せば下流もそのぶん動く
    expect(row?.adminFee).toBeCloseTo(900000 * DEFAULT_RATE_SETTINGS.adminFeeRate);
    expect(row?.profit).toBeCloseTo((row?.sales ?? 0) - (row?.expense ?? 0));
  });

  /**
   * 車番303の「その月は表に載せない」扱い。
   * upsertMany は書くだけで消さないため、前回の確定で書いた行を明示的に落とす必要がある。
   */
  it("除外指定した車両は行を作らず、前回書いた行も収支表から消す", async () => {
    const importBatchRepo = stubImportBatchRepo({ vehicle_operation: [], sales_monitor: [], payroll: [] });
    const { repo: vehiclePlRepo, calls, removed } = stubVehiclePlRepo();
    const useCase = new FinalizeMonthlyPlUseCase(
      importBatchRepo,
      stubVehicleMasterRepo([baseVehicle({ vehicleNo: "10" }), baseVehicle({ vehicleNo: "303" })]),
      stubDriverMasterRepo([]),
      stubRateMasterRepo(),
      vehiclePlRepo,
    );

    const result = await useCase.execute({
      yearMonth: "2026-05",
      manualInputs: [],
      overrides: [
        { vehicleNo: "303", excluded: true, values: {}, reason: "5月は稼働なし" },
      ],
    });

    expect(result.rows.map((r) => r.no)).toEqual(["10"]);
    expect(removed).toEqual([{ yearMonth: "2026-05", vehicleNos: ["303"] }]);
    expect(calls[0]?.rows).toHaveLength(1);
  });

  /**
   * トレーラ(被けん引車)は運賃も運転者も付かないのに保険・税・リース料だけが付く。
   * けん引先を登録していない状態だと「売上ゼロ・費用だけの赤字行」が収支表に並ぶ。
   */
  it("トレーラの固定費をトラクタの行に合算し、トレーラ単独の行は出さない", async () => {
    const importBatchRepo = stubImportBatchRepo({
      vehicle_operation: [],
      sales_monitor: [],
      payroll: [],
    });
    const { repo, calls, removed } = stubVehiclePlRepo();

    const result = await new FinalizeMonthlyPlUseCase(
      importBatchRepo,
      stubVehicleMasterRepo([
        baseVehicle({ vehicleNo: "129", vehicleType: "セミトレ", costCategory: "semiTrailer", lease: 30000 }),
        baseVehicle({
          vehicleNo: "1113",
          vehicleType: "被けん引車",
          costCategory: "trailer",
          towedByVehicleNo: "129",
          insCompulsory: 900,
          insVoluntary: 0,
          taxAuto: 5000,
          taxWeight: 0,
          lease: 12000,
        }),
      ]),
      stubDriverMasterRepo([]),
      stubRateMasterRepo(),
      repo,
    ).execute({ yearMonth: "2026-05", manualInputs: [] });

    expect(result.rows.map((r) => r.no)).toEqual(["129"]);
    const row = result.rows[0]!;
    expect(row.lease).toBe(30000 + 12000);
    expect(row.insCompulsory).toBe(1000 + 900);
    expect(row.taxAuto).toBe(500 + 5000);
    expect(row.towedVehicleNos).toEqual(["1113"]);
    expect(calls[0]?.rows).toHaveLength(1);
    // 対応を登録する前の月に書いた 1113 の行が残ると二重計上になるので消す
    expect(removed[0]?.vehicleNos).toContain("1113");
  });

  /**
   * けん引先の車番を打ち間違えた・トラクタが廃車になった場合に行が黙って消えると、
   * 台数だけが合わなくなって原因を追えない。行き場が無いトレーラは独立した行で残す。
   */
  it("けん引先が車両マスタに居ないトレーラは、単独の行として残す", async () => {
    const { repo } = stubVehiclePlRepo();

    const result = await new FinalizeMonthlyPlUseCase(
      stubImportBatchRepo({ vehicle_operation: [], sales_monitor: [], payroll: [] }),
      stubVehicleMasterRepo([
        baseVehicle({ vehicleNo: "1113", costCategory: "trailer", towedByVehicleNo: "999" }),
      ]),
      stubDriverMasterRepo([]),
      stubRateMasterRepo(),
      repo,
    ).execute({ yearMonth: "2026-05", manualInputs: [] });

    expect(result.rows.map((r) => r.no)).toEqual(["1113"]);
  });

  it("けん引するトラクタを収支表から外すと、ぶら下がるトレーラも一緒に消える", async () => {
    const { repo } = stubVehiclePlRepo();

    const result = await new FinalizeMonthlyPlUseCase(
      stubImportBatchRepo({ vehicle_operation: [], sales_monitor: [], payroll: [] }),
      stubVehicleMasterRepo([
        baseVehicle({ vehicleNo: "129", costCategory: "semiTrailer" }),
        baseVehicle({ vehicleNo: "1113", costCategory: "trailer", towedByVehicleNo: "129" }),
      ]),
      stubDriverMasterRepo([]),
      stubRateMasterRepo(),
      repo,
    ).execute({
      yearMonth: "2026-05",
      manualInputs: [],
      overrides: [
        { vehicleNo: "129", excluded: true, values: {}, reason: "5月は稼働なし" },
      ],
    });

    expect(result.rows).toEqual([]);
  });
});
