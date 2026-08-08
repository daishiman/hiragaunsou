import type { ManualInputRepository } from "../../domain/repositories/ManualInputRepository";
import type {
  AppSettingRepository,
  CleansingDecisionRepository,
} from "../../domain/repositories/CleansingDecisionRepository";
import type { RateMasterRepository } from "../../domain/repositories/MasterRepository";
import type { VehiclePlOverrideRepository } from "../../domain/repositories/VehiclePlOverrideRepository";
import {
  allocateKirinSupport,
  DEFAULT_KIRIN_TARGET_VEHICLES,
} from "../../domain/rules/kirinAllocation";
import { CLEANSING_SOURCE_TYPE } from "./getCleansingQueue";
import type { FinalizeMonthlyPlInput, FinalizeMonthlyPlResult } from "./finalizeMonthlyPl";

/** RATE_KEYS の該当値。Infrastructure層の定数に依存しないよう、ここでも同じキー名を持つ。 */
const KIRIN_TRANSPORT_SUPPORT_KEY = "kirin_transport_support";
const KIRIN_MANAGEMENT_SUPPORT_KEY = "kirin_management_support";

/** キリン配賦先車番の設定キー (APP_SETTING_KEYS.kirinTargetVehicleNos と同じ値)。 */
const KIRIN_TARGET_VEHICLE_NOS_KEY = "kirin_target_vehicle_nos";

/** "24,300" のような設定値を車番の配列にする。空なら null を返して既定値へ委ねる。 */
export function parseVehicleNoList(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return list.length > 0 ? list : null;
}

/** 収支表を作り直す委譲先 (FinalizeMonthlyPlUseCase)。テスト差し替えのため型で受ける。 */
export interface MonthlyPlFinalizer {
  execute(input: FinalizeMonthlyPlInput): Promise<FinalizeMonthlyPlResult>;
}

/**
 * 収支表(vehicle_pl)を作り直す唯一の入口。
 *
 * 収支表は「手入力」「STEP2の整形判断」「キリン配賦」「車両単位の最終上書き」「車両マスタ」「取り込んだCSV」から
 * 毎回まるごと作り直される。呼び出し側がこの材料を自分で集めていると、集め忘れた画面が
 * 静かに値を消す。実際、リース料の更新APIはキリン配賦を渡さずに収支表を作り直していたため、
 * リース料を1台直すだけで24番・300番への配賦額が全部消えていた。
 *
 * そこで材料集めをここに閉じ込め、呼び出し側には年月だけを渡させる。
 * 引数が年月しかないので、そもそも「渡し忘れ」が起こせない形にしてある。
 *
 * この設計の前提として、再計算に効く値はすべて永続化されている必要がある
 * (キリンの受取額をレートマスタに保存しているのはこのため)。
 * 新しい入力項目を足すときは、必ず保存先を用意してからここで読み込むこと。
 */
export class RecalculateMonthlyPlUseCase {
  constructor(
    private readonly manualInputRepo: ManualInputRepository,
    private readonly cleansingRepo: CleansingDecisionRepository,
    private readonly appSettingRepo: AppSettingRepository,
    private readonly rateMasterRepo: RateMasterRepository,
    private readonly overrideRepo: VehiclePlOverrideRepository,
    private readonly finalizer: MonthlyPlFinalizer,
  ) {}

  async execute(input: { yearMonth: string }): Promise<FinalizeMonthlyPlResult> {
    const { yearMonth } = input;

    const [
      manualInputs,
      cleansingDecisions,
      targetSetting,
      transportSupport,
      managementSupport,
      overrides,
    ] = await Promise.all([
      this.manualInputRepo.findByYearMonth(yearMonth),
      this.cleansingRepo.findByYearMonth(yearMonth, CLEANSING_SOURCE_TYPE),
      this.appSettingRepo.get(KIRIN_TARGET_VEHICLE_NOS_KEY),
      this.rateMasterRepo.getRate(KIRIN_TRANSPORT_SUPPORT_KEY, yearMonth, 0),
      this.rateMasterRepo.getRate(KIRIN_MANAGEMENT_SUPPORT_KEY, yearMonth, 0),
      this.overrideRepo.findByYearMonth(yearMonth),
    ]);

    const kirinAllocations = allocateKirinSupport({
      transportSupport,
      managementSupport,
      targetVehicleNos: parseVehicleNoList(targetSetting) ?? [...DEFAULT_KIRIN_TARGET_VEHICLES],
    });

    return this.finalizer.execute({
      yearMonth,
      manualInputs,
      kirinAllocations,
      cleansingDecisions,
      overrides,
    });
  }
}
