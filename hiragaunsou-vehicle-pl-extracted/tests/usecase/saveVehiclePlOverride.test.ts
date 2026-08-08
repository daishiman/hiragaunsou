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
  VehiclePlOverrideConflictError,
} from "../../src/usecase/steps/saveVehiclePlOverride";

function build() {
  const saved: { yearMonth: string; override: VehiclePlOverride; updatedBy: string | null }[] = [];
  const removed: { yearMonth: string; vehicleNo: string }[] = [];
  const applied: { yearMonth: string; asOf: Date }[] = [];
  // 保存 → 未反映 → 反映済み という状態を持つ偽リポジトリ。
  // 「保存しただけでは反映済みにならない」ことを確かめたいので、状態を持たせる。
  const store = new Map<string, VehiclePlOverrideRecord>();

  const overrideRepo: VehiclePlOverrideRepository = {
    findByYearMonth: async () => [...store.values()],
    findOne: async (_yearMonth, vehicleNo) => store.get(vehicleNo) ?? null,
    save: async (yearMonth, override, updatedBy) => {
      saved.push({ yearMonth, override, updatedBy });
      store.set(override.vehicleNo, {
        ...override,
        updatedAt: new Date(2026, 4, 20, 10, 0, 0),
        updatedByName: null,
        appliedAt: null,
      });
    },
    remove: async (yearMonth, vehicleNo) => {
      removed.push({ yearMonth, vehicleNo });
      store.delete(vehicleNo);
    },
    countPending: async () => [...store.values()].filter((r) => r.appliedAt === null).length,
    markApplied: async (yearMonth, asOf) => {
      applied.push({ yearMonth, asOf });
      for (const [key, record] of store) {
        if (record.updatedAt.getTime() <= asOf.getTime()) {
          store.set(key, { ...record, appliedAt: asOf });
        }
      }
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

  return { overrideRepo, recalculate, auditLog, saved, removed, entries, applied, store };
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
    expect(result).toMatchObject({
      yearMonth: "2026-05",
      vehicleNo: "10",
      vehicleCount: 96,
      // 続けて作り直したので、反映待ちは残らない
      pendingCount: 0,
    });
  });

  /**
   * 収支表の画面では指摘を続けて直すため、1件ごとに月まるごとの再計算を走らせると待ち時間が積み上がる。
   * 後回しにしたときは、保存だけが済み、反映待ちとして件数に出ることを固定する
   * (件数に出ないと、直したのに表に反映されないまま気づかれない)。
   */
  it("後回しを指定したら保存だけ済ませ、反映待ちとして残す", async () => {
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
      deferRecalculation: true,
    });

    expect(saved).toHaveLength(1);
    expect(recalculate).not.toHaveBeenCalled();
    expect(result.vehicleCount).toBeNull();
    expect(result.pendingCount).toBe(1);
    expect(result.updatedAt).toBe(new Date(2026, 4, 20, 10, 0, 0).getTime());
  });

  /**
   * 上書きは年月×車番で1レコードなので、別の列を直していても書き換え先は同じになる。
   * 開いた時点の最終更新時刻と食い違ったら、先に直した人の内容を消させない。
   */
  it("他の人が先に直していたら保存せず、競合として知らせる", async () => {
    const { overrideRepo, recalculate, auditLog, saved } = build();
    const usecase = new SaveVehiclePlOverrideUseCase(overrideRepo, { execute: recalculate }, auditLog);

    await usecase.execute({
      ...actor,
      yearMonth: "2026-05",
      vehicleNo: "10",
      excluded: false,
      values: { fare: 900_000 },
      reason: "先に直した人",
      deferRecalculation: true,
    });

    await expect(
      usecase.execute({
        ...actor,
        yearMonth: "2026-05",
        vehicleNo: "10",
        excluded: false,
        values: { fee: 10_000 },
        reason: "何も無かったつもりで直す",
        deferRecalculation: true,
        // 直しがまだ無いと思って開いた画面からの保存
        expectedUpdatedAt: null,
      }),
    ).rejects.toBeInstanceOf(VehiclePlOverrideConflictError);

    expect(saved).toHaveLength(1);
  });

  /** 続けて直せるように、直前に保存した時刻を送り返した場合は通す。 */
  it("自分が直した直後の続けての保存は通す", async () => {
    const { overrideRepo, recalculate, auditLog, saved } = build();
    const usecase = new SaveVehiclePlOverrideUseCase(overrideRepo, { execute: recalculate }, auditLog);

    const first = await usecase.execute({
      ...actor,
      yearMonth: "2026-05",
      vehicleNo: "10",
      excluded: false,
      values: { fare: 900_000 },
      reason: "請求側で15万円減額",
      deferRecalculation: true,
    });

    await usecase.execute({
      ...actor,
      yearMonth: "2026-05",
      vehicleNo: "10",
      excluded: false,
      values: { fare: 900_000, fee: 10_000 },
      reason: "請求側で15万円減額",
      deferRecalculation: true,
      expectedUpdatedAt: first.updatedAt,
    });

    expect(saved).toHaveLength(2);
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
