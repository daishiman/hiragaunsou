import type { AuditLogRepository } from "../../domain/repositories/AuditLogRepository";
import type { VehiclePlOverrideRepository } from "../../domain/repositories/VehiclePlOverrideRepository";
import type { MonthlyPlRecalculator } from "./saveVehiclePlOverride";

export const APPLY_PENDING_OVERRIDES_ACTION = "apply_pending_vehicle_pl_overrides";

export interface ApplyPendingOverridesResult {
  yearMonth: string;
  /** 今回反映した直しの件数 */
  appliedCount: number;
  /** 作り直した収支表の車両数 */
  vehicleCount: number;
  /** 反映後に残っている未反映の件数 (通常は0。反映中に他の人が直すと残る) */
  pendingCount: number;
}

/**
 * 溜まっている直しを収支表へまとめて反映する。
 *
 * 収支表は全車両を一度に組み立てる構造で、キリン協力金は複数車両に按分され、
 * トレーラはトラクタの行に吸収される。つまり1台の直しが他の行に波及しうるため、
 * 「直した車両だけを作り直す」差分計算は全体と同じ知識を持たないと成立しない。
 *
 * そこで差分計算は作らず、再計算を呼ぶ回数を減らすことで待ち時間を解いている。
 * 指摘を30件直しても、収支表の作り直しはこの1回だけになる。
 */
export class ApplyPendingOverridesUseCase {
  constructor(
    private readonly overrideRepo: VehiclePlOverrideRepository,
    private readonly recalculator: MonthlyPlRecalculator,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: {
    yearMonth: string;
    actorId: string;
    actorName: string;
  }): Promise<ApplyPendingOverridesResult> {
    const appliedCount = await this.overrideRepo.countPending(input.yearMonth);

    // 反映済みの印は「再計算を始めた時刻」で付ける。終わった時刻で付けると、
    // 再計算の最中に保存された直しまで反映済みになり、静かに古い数字が残る。
    const startedAt = new Date();
    const result = await this.recalculator.execute({ yearMonth: input.yearMonth });
    await this.overrideRepo.markApplied(input.yearMonth, startedAt);

    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: APPLY_PENDING_OVERRIDES_ACTION,
      summary: `${input.yearMonth} の直し${appliedCount}件を収支表に反映(${result.vehicleCount}台を作り直し)`,
      detail: { yearMonth: input.yearMonth, appliedCount, vehicleCount: result.vehicleCount },
    });

    return {
      yearMonth: input.yearMonth,
      appliedCount,
      vehicleCount: result.vehicleCount,
      pendingCount: await this.overrideRepo.countPending(input.yearMonth),
    };
  }
}
