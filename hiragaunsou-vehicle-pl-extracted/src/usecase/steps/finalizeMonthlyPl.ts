import { aggregateSalesByVehicle, type SalesMonitorRow } from "../../infrastructure/parsers/salesMonitorParser";
import type { VehicleOperationRecord } from "../../infrastructure/parsers/vehicleOperationParser";
import type { PayrollRecord } from "../../infrastructure/parsers/payrollParser";
import { calculateVehiclePl, type VehiclePlCalculated, type VehiclePlInput } from "../../domain/rules/vehiclePlCalculation";
import { STANDARD_COST_RATES } from "../../domain/entities/VehiclePl";
import type { ImportBatchRepository, VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type {
  VehicleMasterRepository,
  DriverMasterRepository,
  RateMasterRepository,
} from "../../domain/repositories/MasterRepository";
import type { CleansingDecisionRecord } from "../../domain/repositories/CleansingDecisionRepository";
import { applyCleansingDecisions } from "./getCleansingQueue";
import { applyVehiclePlOverride, type VehiclePlOverride } from "../../domain/rules/vehiclePlOverride";
import { mergeTowedVehicles } from "../../domain/rules/towedVehicle";
import type { DriverMasterRecord } from "../../domain/repositories/MasterRepository";

/** 車両1台分の給与集計(社員コード→運転者マスタ→車両の連鎖の結果)。 */
export interface VehiclePayrollAggregate {
  vehicleNo: string;
  /** 社員コード。2人乗務等で複数名いる場合は driverName と同じ順で "/" 区切り */
  employeeCode: string;
  /** 2人乗務等で複数名いる場合は "/" 区切り */
  driverName: string;
  /** 総支給額(複数名の場合は合算) */
  salary: number;
  /** 社保合計額(複数名の場合は合算) */
  welfare: number;
  /** 乗務員数(賞与は1人あたりの支給額のため、2人乗務車両は2人分になる) */
  driverCount: number;
  /**
   * 割り当てられた乗務員のうち、給与集計表に社員Noが見つかった人数。
   * driverCount と食い違うとき、その車両の給与は「運転者マスタには居るが給与データが無い」状態で
   * 0円のまま集計されている。0円が「本当に0円」なのか「突合が外れている」のかを
   * 金額だけからは区別できないため、人数として持ち出す。
   */
  payrollMatchedCount: number;
}

/**
 * 社員コード→運転者マスタ→車両、の連鎖で給与集計表(raw_ingestion)を車両単位に集約する。
 * STEP7の収支確定(このファイル内)と、STEP3「人件費の確認」画面の車両別内訳表示
 * (getPayrollDetailByVehicle.ts)の両方から呼ばれる共通ロジック。
 * 二重実装すると突合ロジックがずれる恐れがあるため、ここに一本化する。
 */
export function aggregatePayrollByVehicle(
  payrollRawRows: readonly { naturalKey: string | null; raw: unknown }[],
  drivers: readonly DriverMasterRecord[],
): Map<string, VehiclePayrollAggregate> {
  const payrollByEmployee = new Map<string, PayrollRecord>();
  for (const r of payrollRawRows) {
    if (r.naturalKey) payrollByEmployee.set(r.naturalKey, r.raw as PayrollRecord);
  }

  const result = new Map<string, VehiclePayrollAggregate>();
  for (const driver of drivers) {
    if (!driver.vehicleNo) continue;
    const payroll = payrollByEmployee.get(driver.employeeCode);
    const existing = result.get(driver.vehicleNo) ?? {
      vehicleNo: driver.vehicleNo,
      employeeCode: "",
      driverName: "",
      salary: 0,
      welfare: 0,
      driverCount: 0,
      payrollMatchedCount: 0,
    };
    result.set(driver.vehicleNo, {
      vehicleNo: driver.vehicleNo,
      employeeCode: existing.employeeCode
        ? `${existing.employeeCode}/${driver.employeeCode}`
        : driver.employeeCode,
      driverName: existing.driverName ? `${existing.driverName}/${driver.driverName}` : driver.driverName,
      salary: existing.salary + (payroll?.totalPay ?? 0),
      welfare: existing.welfare + (payroll?.socialInsuranceTotal ?? 0),
      driverCount: existing.driverCount + 1,
      payrollMatchedCount: existing.payrollMatchedCount + (payroll ? 1 : 0),
    });
  }
  return result;
}

/**
 * STEP7: 収支確定(締め)ユースケース。
 *
 * 要件定義§2.3の連鎖反映ルールに従い、車両マスタを起点に
 * STEP1-3で取り込んだraw_ingestion(運行実績/売上/給与)とレートマスタを突合し、
 * calculateVehiclePl で下流の固定費/変動費/損益を再計算してから永続化する。
 * 「下流の値は絶対に手入力させない」原則に対応し、上流データが揃っている限り
 * このユースケースが再計算の唯一の入口になる。
 *
 * 燃料(インタンク/外部給油量・アドブルー)・修理実費・備品・メンテ・その他諸経費は
 * 層③(人間入力)の値としてこのユースケースの引数で受け取る
 * (要件定義§2.2: 燃料は「1次ソース接続が最大の棚卸し対象。取れなければ車両×金額の一括貼付UI」)。
 */
export interface ManualVehicleInput {
  vehicleNo: string;
  /** STEP3 燃料費 */
  fuelInQty: number;
  fuelOut: number;
  fuelOutQty: number;
  adblue: number;
  /** STEP5 経費(修繕費・タイヤ) */
  repairActual: number;
  /** タイヤ実費。未入力(null)なら km×単価の標準原価にフォールバックする */
  tireActual?: number | null;
  equip: number;
  mainte: number;
  /** STEP6 高速料金。未入力(null)なら売上モニタリスト由来の通行料/組合割引率で近似する */
  tollActual?: number | null;
  tollDiscountActual?: number | null;
  miscOther: number;
}

export interface FinalizeMonthlyPlInput {
  yearMonth: string;
  manualInputs: ManualVehicleInput[];
  /**
   * STEP2: キリンの輸送協力金・経営支援金の配賦結果 (車番 → 加算額)。
   * 現行Excelは配賦額を収支表 L列「高速他料金」(=売上側) に載せているため、
   * 附帯料金に加算する (置き換えない)。費用側の諸経費ではない。
   */
  kirinAllocations?: readonly { vehicleNo: string; amount: number }[];
  /**
   * STEP2: データ整形で人が下した判断 (除外する/車番を修正して残す)。
   * 元データは書き換えず、集計の直前にここで重ねる。
   */
  cleansingDecisions?: readonly CleansingDecisionRecord[];
  /**
   * STEP7: 車両単位の最終上書き (請求側の事情でCSV由来の値を人が直したもの)。
   * 計算の入口の値だけを差し替え、下流は calculateVehiclePl が作り直す。
   * excluded の車両はその月の収支表に載せない。
   */
  overrides?: readonly VehiclePlOverride[];
}

export interface FinalizeMonthlyPlResult {
  yearMonth: string;
  vehicleCount: number;
  rows: VehiclePlCalculated[];
}

const ZERO_MANUAL_INPUT: Omit<ManualVehicleInput, "vehicleNo"> = {
  fuelInQty: 0,
  fuelOut: 0,
  fuelOutQty: 0,
  adblue: 0,
  repairActual: 0,
  tireActual: null,
  equip: 0,
  mainte: 0,
  tollActual: null,
  tollDiscountActual: null,
  miscOther: 0,
};

export class FinalizeMonthlyPlUseCase {
  constructor(
    private readonly importBatchRepo: ImportBatchRepository,
    private readonly vehicleMasterRepo: VehicleMasterRepository,
    private readonly driverMasterRepo: DriverMasterRepository,
    private readonly rateMasterRepo: RateMasterRepository,
    private readonly vehiclePlRepo: VehiclePlRepository,
  ) {}

  async execute(input: FinalizeMonthlyPlInput): Promise<FinalizeMonthlyPlResult> {
    /*
      取込が1件も無い月には収支表を作らない。

      収支表の行は車両マスタの車両から作られるため、取込が無くても「全車両ぶんの行」は作れて
      しまう。走行も売上も0なので、固定費だけが並ぶ赤字の行が台数ぶんできる。実際に本番では
      取込が1件も無い月に101台ぶんの行(売上0円・損益▲882万円)が残り、ホームの経営サマリが
      その架空の月の数字を出していた。

      入口(取込直後・作り直し・手入力の保存・マスタ変更の反映)ごとに条件を書くと、
      書き漏らした経路から同じことが起きる。行を書く唯一の場所であるここで止める。
    */
    const monthBatches = await Promise.all(
      ["vehicle_operation", "sales_monitor", "payroll"].map((sourceType) =>
        this.importBatchRepo.findLatestBatch(input.yearMonth, sourceType),
      ),
    );
    if (monthBatches.every((batch) => batch === null)) {
      return { yearMonth: input.yearMonth, vehicleCount: 0, rows: [] };
    }

    const [opRawRows, salesRawRows, payrollRawRows, vehicles, drivers, rates] = await Promise.all([
      this.importBatchRepo.findRawRows(input.yearMonth, "vehicle_operation"),
      this.importBatchRepo.findRawRows(input.yearMonth, "sales_monitor"),
      this.importBatchRepo.findRawRows(input.yearMonth, "payroll"),
      this.vehicleMasterRepo.findAllActive(),
      this.driverMasterRepo.findAll(),
      this.rateMasterRepo.getRates(input.yearMonth),
    ]);

    const opByVehicle = new Map<string, VehicleOperationRecord>();
    for (const r of opRawRows) {
      if (r.naturalKey) opByVehicle.set(r.naturalKey, r.raw as VehicleOperationRecord);
    }

    // STEP2のデータ整形の判断を先に重ねてから集計する
    const salesRows = applyCleansingDecisions(
      salesRawRows.map((r) => r.raw as SalesMonitorRow),
      input.cleansingDecisions ?? [],
    );
    const salesAgg = aggregateSalesByVehicle(salesRows);

    const driversByVehicle = aggregatePayrollByVehicle(payrollRawRows, drivers);

    const manualByVehicle = new Map<string, ManualVehicleInput>();
    for (const m of input.manualInputs) {
      manualByVehicle.set(m.vehicleNo, m);
    }

    // STEP2: キリン配賦は売上(高速他料金)への加算。集計済みの値を消さずに足す。
    const kirinByVehicle = new Map<string, number>();
    for (const a of input.kirinAllocations ?? []) {
      kirinByVehicle.set(a.vehicleNo, (kirinByVehicle.get(a.vehicleNo) ?? 0) + a.amount);
    }

    // STEP7: 車両単位の最終上書き。excluded の車両は行ごと落とすため、計算の前に分けておく。
    const overrideByVehicle = new Map<string, VehiclePlOverride>();
    for (const o of input.overrides ?? []) {
      overrideByVehicle.set(o.vehicleNo, o);
    }

    // STEP7: トレーラ(被けん引車)はけん引するトラクタの行に合算し、単独では出さない。
    // 除外された(excluded)トラクタにぶら下がるトレーラは行き場が無いので、一緒に消える。
    const activeVehicles = vehicles.filter(
      (vehicle) => !overrideByVehicle.get(vehicle.vehicleNo)?.excluded,
    );
    // 「けん引先が車両マスタに居ない」と「けん引先を人が今月だけ外した」は別物として扱う。
    // 前者は車番の打ち間違いや廃車で、黙って消すと台数だけが合わなくなるので独立行で残す。
    // 後者は「今月は動いていない」という判断なので、ぶら下がるトレーラも一緒に落とす
    // (残すと、まさに解消したかった「売上ゼロ・費用だけの赤字行」が戻ってくる)。
    const knownTractorNos = new Set(
      vehicles.filter((v) => !v.towedByVehicleNo).map((v) => v.vehicleNo),
    );
    const trailersByTractor = new Map<string, string[]>();
    const droppedWithTractor: string[] = [];
    for (const v of activeVehicles) {
      if (!v.towedByVehicleNo || !knownTractorNos.has(v.towedByVehicleNo)) continue;
      if (overrideByVehicle.get(v.towedByVehicleNo)?.excluded) {
        droppedWithTractor.push(v.vehicleNo);
        continue;
      }
      const list = trailersByTractor.get(v.towedByVehicleNo) ?? [];
      list.push(v.vehicleNo);
      trailersByTractor.set(v.towedByVehicleNo, list);
    }
    const mergedIntoTractor = new Set([
      ...[...trailersByTractor.values()].flat(),
      ...droppedWithTractor,
    ]);

    const toPlInput = (vehicle: (typeof activeVehicles)[number]): VehiclePlInput => {
      const op = opByVehicle.get(vehicle.vehicleNo);
      const sales = salesAgg.get(vehicle.vehicleNo);
      const driver = driversByVehicle.get(vehicle.vehicleNo);
      const manual = manualByVehicle.get(vehicle.vehicleNo) ?? {
        vehicleNo: vehicle.vehicleNo,
        ...ZERO_MANUAL_INPUT,
      };
      const standardCostRate =
        STANDARD_COST_RATES[vehicle.costCategory] ?? STANDARD_COST_RATES["medium"]!;

      const plInput: VehiclePlInput = {
        no: vehicle.vehicleNo,
        type: vehicle.vehicleType,
        depot: vehicle.depot,
        reg: vehicle.regDate,
        // 社員コードは運転者マスタから来る。ここを null で埋めていたため、
        // 出力CSVの「社員コード」列が全行空になり、給与の突合先を人が辿れなくなっていた。
        code: driver?.employeeCode || null,
        driver: driver?.driverName ?? null,
        trips: op?.tripCount ?? 0,
        slips: sales?.slipCount ?? 0,
        hours: op?.operatingHours ?? 0,
        km: op?.totalDistanceKm ?? 0,
        fare: sales?.fare ?? 0,
        fee: (sales?.ancillaryFee ?? 0) + (kirinByVehicle.get(vehicle.vehicleNo) ?? 0),
        toll: sales?.toll ?? 0,
        fuelInQty: manual.fuelInQty,
        fuelOutQty: manual.fuelOutQty,
        fuelOut: manual.fuelOut,
        adblue: manual.adblue,
        repairActual: manual.repairActual,
        tireActual: manual.tireActual ?? null,
        tollActual: manual.tollActual ?? null,
        tollDiscountActual: manual.tollDiscountActual ?? null,
        equip: manual.equip,
        mainte: manual.mainte,
        salary: driver?.salary ?? 0,
        welfare: driver?.welfare ?? 0,
        insCompulsory: vehicle.insCompulsory,
        insVoluntary: vehicle.insVoluntary,
        taxAuto: vehicle.taxAuto,
        taxWeight: vehicle.taxWeight,
        miscOther: manual.miscOther,
        driverCount: driver?.driverCount ?? 0,
        lease: vehicle.lease,
        installment: vehicle.installment,
        standardCostRate,
      };

      // 上書きは計算の入口にだけ重ねる。損益・経費計・各小計はここから必ず作り直されるので、
      // 「損益 = 運送収入 - 経費計」は上書き後も成立する。
      return applyVehiclePlOverride(plInput, overrideByVehicle.get(vehicle.vehicleNo));
    };

    const inputByVehicle = new Map<string, VehiclePlInput>(
      activeVehicles.map((v) => [v.vehicleNo, toPlInput(v)]),
    );

    // トレーラの合算も calculateVehiclePl の手前で済ませる。下流を足し合わせると
    // 一般管理費が合算前の運送収入に対する額の和になり、率との関係が崩れる。
    const rows: VehiclePlCalculated[] = activeVehicles
      .filter((vehicle) => !mergedIntoTractor.has(vehicle.vehicleNo))
      .map((vehicle) => {
        const trailers = (trailersByTractor.get(vehicle.vehicleNo) ?? [])
          .map((no) => inputByVehicle.get(no))
          .filter((v): v is VehiclePlInput => v !== undefined);
        return calculateVehiclePl(
          mergeTowedVehicles(inputByVehicle.get(vehicle.vehicleNo)!, trailers),
          rates,
        );
      });

    // 「今月は載せない」に切り替えた車両は、前回の確定で書いた行が残っている。
    // upsertMany は書くだけで消さないので、除外分は明示的に落とす。
    // 除外した車両に加え、トラクタに吸収されたトレーラの行も落とす。
    // 対応を登録した月から車番の行が消えるので、前回の確定結果が残ると二重計上になる。
    const excludedVehicleNos = [
      ...(input.overrides ?? []).filter((o) => o.excluded).map((o) => o.vehicleNo),
      ...mergedIntoTractor,
    ];
    await this.vehiclePlRepo.removeVehicles(input.yearMonth, excludedVehicleNos);
    await this.vehiclePlRepo.upsertMany(input.yearMonth, rows);

    return { yearMonth: input.yearMonth, vehicleCount: rows.length, rows };
  }
}
