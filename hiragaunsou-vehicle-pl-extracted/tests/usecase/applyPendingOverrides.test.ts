import { describe, expect, it, vi } from "vitest";
import type { AuditLogRecord, AuditLogRepository } from "../../src/domain/repositories/AuditLogRepository";
import type {
  VehiclePlOverrideRecord,
  VehiclePlOverrideRepository,
} from "../../src/domain/repositories/VehiclePlOverrideRepository";
import {
  APPLY_PENDING_OVERRIDES_ACTION,
  ApplyPendingOverridesUseCase,
} from "../../src/usecase/steps/applyPendingOverrides";

function record(vehicleNo: string, appliedAt: Date | null): VehiclePlOverrideRecord {
  return {
    vehicleNo,
    excluded: false,
    values: { fare: 900_000 },
    reason: "請求側で15万円減額",
    updatedAt: new Date(2026, 4, 20, 10, 0, 0),
    updatedByName: null,
    appliedAt,
  };
}

function build(initial: VehiclePlOverrideRecord[]) {
  const store = new Map(initial.map((r) => [r.vehicleNo, r]));
  const marked: { yearMonth: string; asOf: Date }[] = [];

  const overrideRepo: VehiclePlOverrideRepository = {
    findByYearMonth: async () => [...store.values()],
    findOne: async (_ym, vehicleNo) => store.get(vehicleNo) ?? null,
    save: async () => {},
    remove: async () => {},
    countPending: async () => [...store.values()].filter((r) => r.appliedAt === null).length,
    markApplied: async (yearMonth, asOf) => {
      marked.push({ yearMonth, asOf });
      for (const [key, r] of store) {
        if (r.updatedAt.getTime() <= asOf.getTime()) store.set(key, { ...r, appliedAt: asOf });
      }
    },
  };

  const entries: AuditLogRecord[] = [];
  const auditLog = {
    record: async (entry: AuditLogRecord) => {
      entries.push(entry);
    },
    findRecent: async () => [],
  } as unknown as AuditLogRepository;

  return { overrideRepo, auditLog, entries, marked, store };
}

const actor = { actorId: "u-1", actorName: "今西" };

describe("ApplyPendingOverridesUseCase", () => {
  /**
   * 指摘を30件直しても収支表の作り直しはこの1回だけ、というのがこの機能の中身。
   * ここで再計算の回数が増えると、直すたびに待たされる元の状態に戻る。
   */
  it("溜まっている直しをまとめて反映し、収支表の作り直しは1回だけ走る", async () => {
    const { overrideRepo, auditLog } = build([record("10", null), record("11", null)]);
    const recalculate = vi.fn(async () => ({ yearMonth: "2026-05", vehicleCount: 106, rows: [] }));

    const result = await new ApplyPendingOverridesUseCase(
      overrideRepo,
      { execute: recalculate },
      auditLog,
    ).execute({ ...actor, yearMonth: "2026-05" });

    expect(recalculate).toHaveBeenCalledTimes(1);
    expect(recalculate).toHaveBeenCalledWith({ yearMonth: "2026-05" });
    expect(result).toMatchObject({
      yearMonth: "2026-05",
      appliedCount: 2,
      vehicleCount: 106,
      pendingCount: 0,
    });
  });

  /**
   * 反映済みの印は「再計算を始めた時刻」で付ける。終わった時刻で付けると、
   * 再計算の最中に別の人が保存した直しまで反映済みになり、静かに古い数字が残る。
   */
  it("再計算の最中に保存された直しは反映済みにしない", async () => {
    const { overrideRepo, store, auditLog } = build([record("10", null)]);
    const recalculate = vi.fn(async () => {
      // 再計算をしている間に、別の人が別の車両を直した
      store.set("11", { ...record("11", null), updatedAt: new Date(Date.now() + 1_000) });
      return { yearMonth: "2026-05", vehicleCount: 106, rows: [] };
    });

    const result = await new ApplyPendingOverridesUseCase(
      overrideRepo,
      { execute: recalculate },
      auditLog,
    ).execute({ ...actor, yearMonth: "2026-05" });

    // 割り込んだ1件は未反映のまま残り、画面に「反映待ち1件」として出る
    expect(result.pendingCount).toBe(1);
    expect(store.get("11")?.appliedAt).toBeNull();
    expect(store.get("10")?.appliedAt).not.toBeNull();
  });

  it("誰がいつ何件反映したかを監査ログに残す", async () => {
    const { overrideRepo, auditLog, entries } = build([record("10", null)]);
    const recalculate = vi.fn(async () => ({ yearMonth: "2026-05", vehicleCount: 106, rows: [] }));

    await new ApplyPendingOverridesUseCase(overrideRepo, { execute: recalculate }, auditLog).execute({
      ...actor,
      yearMonth: "2026-05",
    });

    expect(entries[0]).toMatchObject({
      action: APPLY_PENDING_OVERRIDES_ACTION,
      actorName: "今西",
    });
    expect(entries[0]?.summary).toContain("1件");
  });

  /** 反映待ちが無くても、押した以上は最新の収支表を見せる (押しても何も起きないのは不安になる)。 */
  it("反映待ちが無くても収支表は作り直す", async () => {
    const { overrideRepo, auditLog } = build([]);
    const recalculate = vi.fn(async () => ({ yearMonth: "2026-05", vehicleCount: 106, rows: [] }));

    const result = await new ApplyPendingOverridesUseCase(
      overrideRepo,
      { execute: recalculate },
      auditLog,
    ).execute({ ...actor, yearMonth: "2026-05" });

    expect(recalculate).toHaveBeenCalledTimes(1);
    expect(result.appliedCount).toBe(0);
  });
});
