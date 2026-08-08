import type { VehiclePlOverrideRepository } from "../../domain/repositories/VehiclePlOverrideRepository";
import type { AuditLogRepository } from "../../domain/repositories/AuditLogRepository";
import {
  isOverridableField,
  OVERRIDABLE_FIELD_META,
  type OverridableField,
  type VehiclePlOverride,
} from "../../domain/rules/vehiclePlOverride";
import type { FinalizeMonthlyPlResult } from "./finalizeMonthlyPl";

export const SAVE_VEHICLE_PL_OVERRIDE_ACTION = "save_vehicle_pl_override";
export const CLEAR_VEHICLE_PL_OVERRIDE_ACTION = "clear_vehicle_pl_override";

/** 収支表を作り直す委譲先 (RecalculateMonthlyPlUseCase)。テスト差し替えのため型で受ける。 */
export interface MonthlyPlRecalculator {
  execute(input: { yearMonth: string }): Promise<FinalizeMonthlyPlResult>;
}

export interface SaveVehiclePlOverrideInput {
  yearMonth: string;
  vehicleNo: string;
  excluded: boolean;
  values: Partial<Record<OverridableField, number>>;
  reason: string;
  actorId: string;
  actorName: string;
}

export interface SaveVehiclePlOverrideResult {
  yearMonth: string;
  vehicleNo: string;
  vehicleCount: number;
}

/** 上書きの中身を人が読める1行にする (監査ログの summary 用)。 */
function describe(override: VehiclePlOverride): string {
  if (override.excluded) return "収支表から除外";
  const parts = Object.entries(override.values)
    .filter(([field]) => isOverridableField(field))
    .map(([field, value]) => `${OVERRIDABLE_FIELD_META[field as OverridableField].label}=${value}`);
  return parts.length > 0 ? parts.join(" / ") : "上書きなし";
}

/**
 * 車両単位の最終上書きの保存 / 取り消し。
 *
 * 保存しただけでは収支表の数字は変わらない (収支表は毎回まるごと作り直されるため)。
 * 「保存したのに表が変わらない」を起こさないよう、保存と再計算をここで必ず一組にする。
 *
 * 理由(reason)を必須にしているのは、翌月に同じ手直しをするかどうかを後から誰かが
 * 判断できるようにするため。理由の無い上書きは、来月には正体不明の差になる。
 */
export class SaveVehiclePlOverrideUseCase {
  constructor(
    private readonly overrideRepo: VehiclePlOverrideRepository,
    private readonly recalculator: MonthlyPlRecalculator,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: SaveVehiclePlOverrideInput): Promise<SaveVehiclePlOverrideResult> {
    const reason = input.reason.trim();
    if (reason === "") {
      throw new Error("上書きの理由を入力してください(翌月に同じ判断を引き継ぐために使います)");
    }

    const values: Partial<Record<OverridableField, number>> = {};
    for (const [field, value] of Object.entries(input.values)) {
      if (!isOverridableField(field)) {
        throw new Error(`「${field}」は上書きできない項目です`);
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`「${OVERRIDABLE_FIELD_META[field].label}」に数値を入力してください`);
      }
      if (value < 0) {
        throw new Error(`「${OVERRIDABLE_FIELD_META[field].label}」に負の値は入れられません`);
      }
      values[field] = value;
    }

    if (!input.excluded && Object.keys(values).length === 0) {
      throw new Error("上書きする項目が1つもありません(取り消す場合は取消を使ってください)");
    }

    const override: VehiclePlOverride = {
      vehicleNo: input.vehicleNo,
      excluded: input.excluded,
      values,
      reason,
    };

    await this.overrideRepo.save(input.yearMonth, override, input.actorId);
    // 保存と再計算を分けると「保存したのに表が変わらない」が起きる。必ず続けて作り直す。
    const result = await this.recalculator.execute({ yearMonth: input.yearMonth });

    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: SAVE_VEHICLE_PL_OVERRIDE_ACTION,
      summary: `${input.yearMonth} 車番${input.vehicleNo} を上書き(${describe(override)})`,
      detail: { yearMonth: input.yearMonth, ...override },
    });

    return {
      yearMonth: input.yearMonth,
      vehicleNo: input.vehicleNo,
      vehicleCount: result.vehicleCount,
    };
  }
}

export interface ClearVehiclePlOverrideInput {
  yearMonth: string;
  vehicleNo: string;
  actorId: string;
  actorName: string;
}

/** 上書きを取り消して、CSVと手入力から計算した素の値に戻す。 */
export class ClearVehiclePlOverrideUseCase {
  constructor(
    private readonly overrideRepo: VehiclePlOverrideRepository,
    private readonly recalculator: MonthlyPlRecalculator,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: ClearVehiclePlOverrideInput): Promise<SaveVehiclePlOverrideResult> {
    await this.overrideRepo.remove(input.yearMonth, input.vehicleNo);
    const result = await this.recalculator.execute({ yearMonth: input.yearMonth });

    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: CLEAR_VEHICLE_PL_OVERRIDE_ACTION,
      summary: `${input.yearMonth} 車番${input.vehicleNo} の上書きを取り消し`,
      detail: { yearMonth: input.yearMonth, vehicleNo: input.vehicleNo },
    });

    return {
      yearMonth: input.yearMonth,
      vehicleNo: input.vehicleNo,
      vehicleCount: result.vehicleCount,
    };
  }
}
