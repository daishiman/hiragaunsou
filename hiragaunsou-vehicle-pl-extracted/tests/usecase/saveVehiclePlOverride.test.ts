import { describe, expect, it, vi } from "vitest";
import type { AuditLogRecord, AuditLogRepository } from "../../src/domain/repositories/AuditLogRepository";
import type {
  VehiclePlOverrideRecord,
  VehiclePlOverrideRepository,
} from "../../src/domain/repositories/VehiclePlOverrideRepository";
import type { VehiclePlOverride } from "../../src/domain/rules/vehiclePlOverride";
import {
  CLEAR_VEHICLE_PL_OVERRIDE_ACTION,
  ClearVehiclePlOverrideUseCase,
  SAVE_VEHICLE_PL_OVERRIDE_ACTION,
  SaveVehiclePlOverrideUseCase,
} from "../../src/usecase/steps/saveVehiclePlOverride";

function build() {
  const saved: { yearMonth: string; override: VehiclePlOverride; updatedBy: string | null }[] = [];
  const removed: { yearMonth: string; vehicleNo: string }[] = [];
  const overrideRepo: VehiclePlOverrideRepository = {
    findByYearMonth: async () => [] as VehiclePlOverrideRecord[],
    save: async (yearMonth, override, updatedBy) => {
      saved.push({ yearMonth, override, updatedBy });
    },
    remove: async (yearMonth, vehicleNo) => {
      removed.push({ yearMonth, vehicleNo });
    },
  };

  const recalculate = vi.fn(async () => ({ yearMonth: "2026-05", vehicleCount: 96, rows: [] }));
  const entries: AuditLogRecord[] = [];
  const auditLog = {
    record: async (entry: AuditLogRecord) => {
      entries.push(entry);
    },
    findRecent: async () => [],
  } as unknown as AuditLogRepository;

  return { overrideRepo, recalculate, auditLog, saved, removed, entries };
}

const actor = { actorId: "u-1", actorName: "今西" };

describe("SaveVehiclePlOverrideUseCase", () => {
  /**
   * 収支表は毎回まるごと作り直されるので、保存しただけでは表の数字は変わらない。
   * 保存と再計算が離れていると「保存したのに表が変わらない」が起きるため、一組であることを固定する。
   */
  it("上書きを保存したら、続けて収支表を作り直す", async () => {
    const { overrideRepo, recalculate, auditLog, saved } = build();

    const result = await new SaveVehiclePlOverrideUseCase(
      overrideRepo,
      { execute: recalculate },
      auditLog,
    ).execute({
      ...actor,
      yearMonth: "2026-05",
      vehicleNo: "10",
      excluded: false,
      values: { fare: 900_000 },
      reason: "請求側で15万円減額",
    });

    expect(saved).toEqual([
      {
        yearMonth: "2026-05",
        override: {
          vehicleNo: "10",
          excluded: false,
          values: { fare: 900_000 },
          reason: "請求側で15万円減額",
        },
        updatedBy: "u-1",
      },
    ]);
    expect(recalculate).toHaveBeenCalledWith({ yearMonth: "2026-05" });
    expect(result).toEqual({ yearMonth: "2026-05", vehicleNo: "10", vehicleCount: 96 });
  });

  it("誰が何をどう直したかを監査ログに残す", async () => {
    const { overrideRepo, recalculate, auditLog, entries } = build();

    await new SaveVehiclePlOverrideUseCase(overrideRepo, { execute: recalculate }, auditLog).execute({
      ...actor,
      yearMonth: "2026-05",
      vehicleNo: "10",
      excluded: false,
      values: { fare: 900_000 },
      reason: "請求側で15万円減額",
    });

    expect(entries[0]).toMatchObject({
      action: SAVE_VEHICLE_PL_OVERRIDE_ACTION,
      actorName: "今西",
    });
    expect(entries[0]?.summary).toContain("運賃=900000");
  });

  /**
   * 理由が無い上書きは、翌月には正体不明の差になる。
   * 同じ手直しを続けるかどうかを後から判断できなくなるので、空では保存させない。
   */
  it("理由が空なら保存も再計算もしない", async () => {
    const { overrideRepo, recalculate, auditLog, saved } = build();

    await expect(
      new SaveVehiclePlOverrideUseCase(overrideRepo, { execute: recalculate }, auditLog).execute({
        ...actor,
        yearMonth: "2026-05",
        vehicleNo: "10",
        excluded: false,
        values: { fare: 900_000 },
        reason: "   ",
      }),
    ).rejects.toThrow(/理由/);

    expect(saved).toEqual([]);
    expect(recalculate).not.toHaveBeenCalled();
  });

  it("上書きできない項目が混ざっていたら弾く", async () => {
    const { overrideRepo, recalculate, auditLog } = build();

    await expect(
      new SaveVehiclePlOverrideUseCase(overrideRepo, { execute: recalculate }, auditLog).execute({
        ...actor,
        yearMonth: "2026-05",
        vehicleNo: "10",
        excluded: false,
        values: { profit: 1 } as never,
        reason: "損益を直したい",
      }),
    ).rejects.toThrow(/上書きできない項目/);
  });

  it("負の値は弾く(打ち間違いをそのまま収支表に載せない)", async () => {
    const { overrideRepo, recalculate, auditLog } = build();

    await expect(
      new SaveVehiclePlOverrideUseCase(overrideRepo, { execute: recalculate }, auditLog).execute({
        ...actor,
        yearMonth: "2026-05",
        vehicleNo: "10",
        excluded: false,
        values: { fare: -900_000 },
        reason: "打ち間違い",
      }),
    ).rejects.toThrow(/負の値/);
  });

  it("直す項目が1つも無ければ弾く(空の上書きを残さない)", async () => {
    const { overrideRepo, recalculate, auditLog } = build();

    await expect(
      new SaveVehiclePlOverrideUseCase(overrideRepo, { execute: recalculate }, auditLog).execute({
        ...actor,
        yearMonth: "2026-05",
        vehicleNo: "10",
        excluded: false,
        values: {},
        reason: "とくになし",
      }),
    ).rejects.toThrow(/1つもありません/);
  });

  it("収支表から外す場合は、直す項目が無くても保存できる", async () => {
    const { overrideRepo, recalculate, auditLog, saved, entries } = build();

    await new SaveVehiclePlOverrideUseCase(overrideRepo, { execute: recalculate }, auditLog).execute({
      ...actor,
      yearMonth: "2026-05",
      vehicleNo: "303",
      excluded: true,
      values: {},
      reason: "5月は稼働なしのため表に載せない",
    });

    expect(saved[0]?.override.excluded).toBe(true);
    expect(entries[0]?.summary).toContain("収支表から除外");
  });
});

describe("ClearVehiclePlOverrideUseCase", () => {
  it("上書きを消して収支表を作り直し、取り消しを監査ログに残す", async () => {
    const { overrideRepo, recalculate, auditLog, removed, entries } = build();

    const result = await new ClearVehiclePlOverrideUseCase(
      overrideRepo,
      { execute: recalculate },
      auditLog,
    ).execute({ ...actor, yearMonth: "2026-05", vehicleNo: "10" });

    expect(removed).toEqual([{ yearMonth: "2026-05", vehicleNo: "10" }]);
    expect(recalculate).toHaveBeenCalledWith({ yearMonth: "2026-05" });
    expect(entries[0]).toMatchObject({ action: CLEAR_VEHICLE_PL_OVERRIDE_ACTION });
    expect(result.vehicleCount).toBe(96);
  });
});
