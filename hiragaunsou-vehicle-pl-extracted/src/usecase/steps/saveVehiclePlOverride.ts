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
  /**
   * 収支表への反映(再計算)を後回しにする。
   *
   * 収支表の画面では指摘を続けて直すため、1件ごとに月まるごとの再計算を走らせると
   * 待ち時間が積み上がる。true のときは保存だけを行い、再計算は「まとめて反映」に任せる。
   * 未反映であることはリポジトリが記録するので、反映漏れは件数として画面に出る。
   */
  deferRecalculation?: boolean;
  /**
   * 編集を開いた時点で画面が見ていた、この車両の直しの最終更新時刻 (ミリ秒)。
   * 上書きは年月×車番で1レコードなので、別の列を直していても書き換え先は同じになる。
   * 食い違ったら保存せず、先に直した人の内容を消させない。
   * undefined のときは検査しない (画面を経由しない呼び出しとの互換のため)。
   */
  expectedUpdatedAt?: number | null;
}

export interface SaveVehiclePlOverrideResult {
  yearMonth: string;
  vehicleNo: string;
  /** 再計算した場合の車両数。後回しにしたときは null */
  vehicleCount: number | null;
  /** 収支表に反映していない直しの件数 */
  pendingCount: number;
  /**
   * 保存後のこの車両の直しの最終更新時刻 (ミリ秒)。取り消した場合は null。
   * 画面はこれを次の保存でそのまま送り返し、続けて直しても競合と誤判定されないようにする。
   */
  updatedAt: number | null;
}

/** 他の人が先に同じ車両を直していた。画面は「開き直してください」を出す。 */
export class VehiclePlOverrideConflictError extends Error {
  constructor() {
    super("他の人が先にこの車両を直しました。画面を開き直してから、もう一度直してください");
    this.name = "VehiclePlOverrideConflictError";
  }
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
      throw new Error("直した理由を入力してください（翌月に同じ判定を引き継ぐために使います）");
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
      throw new Error("直す項目が1つもありません（元に戻す場合は取消を使ってください）");
    }

    if (input.expectedUpdatedAt !== undefined) {
      const current = await this.overrideRepo.findOne(input.yearMonth, input.vehicleNo);
      const currentUpdatedAt = current ? current.updatedAt.getTime() : null;
      if (currentUpdatedAt !== input.expectedUpdatedAt) {
        throw new VehiclePlOverrideConflictError();
      }
    }

    const override: VehiclePlOverride = {
      vehicleNo: input.vehicleNo,
      excluded: input.excluded,
      values,
      reason,
    };

    await this.overrideRepo.save(input.yearMonth, override, input.actorId);
    // 保存しただけでは収支表の数字は変わらない(収支表は毎回まるごと作り直されるため)。
    // 既定では続けて作り直し、「保存したのに表が変わらない」を起こさない。
    // 後回しにできるのは、未反映の件数が画面に出て反映漏れに気づける場合だけ。
    // 反映済みの印は「再計算を始めた時刻」で付ける。終わった時刻で付けると、
    // 再計算の最中に別の人が保存した直しまで反映済みになり、静かに古い数字が残る。
    const startedAt = new Date();
    const result = input.deferRecalculation
      ? null
      : await this.recalculator.execute({ yearMonth: input.yearMonth });
    if (result) {
      await this.overrideRepo.markApplied(input.yearMonth, startedAt);
    }

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
      vehicleCount: result?.vehicleCount ?? null,
      pendingCount: await this.overrideRepo.countPending(input.yearMonth),
      updatedAt:
        (await this.overrideRepo.findOne(input.yearMonth, input.vehicleNo))?.updatedAt.getTime() ??
        null,
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
    // 取り消しは元に戻す操作なので、結果をその場で見せる。ここでの再計算は
    // 他に溜まっている未反映の直しもまとめて反映することになるため、印を併せて付ける。
    const startedAt = new Date();
    const result = await this.recalculator.execute({ yearMonth: input.yearMonth });
    await this.overrideRepo.markApplied(input.yearMonth, startedAt);

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
      pendingCount: await this.overrideRepo.countPending(input.yearMonth),
      updatedAt: null,
    };
  }
}
