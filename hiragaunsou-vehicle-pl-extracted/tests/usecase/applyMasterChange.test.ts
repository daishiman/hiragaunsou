import { beforeEach, describe, expect, it } from "vitest";
import {
  ApplyMasterChangeUseCase,
  ApplyToConfirmedMonthUseCase,
  GetMasterChangeStatusUseCase,
  RevertConfirmedMonthApplyUseCase,
  UndoMasterEditUseCase,
  onlyYearMonthOfRateEdit,
  type ConfirmedMonthApplyRecord,
  type MasterChangeHistoryRepository,
  type MasterEditInput,
  type MonthlyPlRebuilder,
} from "../../src/usecase/steps/applyMasterChange";
import type { MonthlyPlPreviewer } from "../../src/usecase/steps/previewMonthlyPl";
import type {
  MasterEditRecord,
  MonthConfirmationState,
} from "../../src/domain/rules/masterChangeImpact";
import type { VehiclePlCalculated } from "../../src/domain/rules/vehiclePlCalculation";
import { plRow } from "../fixtures/vehiclePlRow";
import { stubVehiclePlRepo } from "../fixtures/stubRepositories";

const ACTOR = { id: "u1", name: "管理者" };

/** 履歴と反映記録の入れ物 (メモリ) */
class MemoryHistoryRepo implements MasterChangeHistoryRepository {
  edits: MasterEditRecord[] = [];
  applies: (ConfirmedMonthApplyRecord & { snapshot: VehiclePlCalculated[] })[] = [];
  private seq = 0;

  constructor(private months: MonthConfirmationState[]) {}

  setMonths(months: MonthConfirmationState[]) {
    this.months = months;
  }

  async listMonthlyConfirmations() {
    return this.months;
  }

  async recordEdits(edits: readonly MasterEditInput[]) {
    for (const e of edits) {
      this.edits.unshift({
        id: `e${++this.seq}`,
        ...e,
        editedByName: ACTOR.name,
        editedAt: Date.now(),
        undoneAt: null,
      });
    }
  }

  async listEdits(limit: number) {
    return this.edits.slice(0, limit);
  }

  async findEdit(id: string) {
    return this.edits.find((e) => e.id === id) ?? null;
  }

  async markEditUndone(id: string) {
    const e = this.edits.find((x) => x.id === id);
    if (e) e.undoneAt = Date.now();
  }

  async recordApply(input: {
    yearMonth: string;
    summary: string;
    snapshot: readonly VehiclePlCalculated[];
  }) {
    const id = `a${++this.seq}`;
    this.applies.unshift({
      id,
      yearMonth: input.yearMonth,
      summary: input.summary,
      appliedByName: ACTOR.name,
      appliedAt: Date.now(),
      revertedAt: null,
      snapshot: [...input.snapshot],
    });
    return id;
  }

  async listApplies(limit: number) {
    return this.applies.slice(0, limit);
  }

  async findApplySnapshot(id: string) {
    const a = this.applies.find((x) => x.id === id);
    return a ? { yearMonth: a.yearMonth, snapshot: a.snapshot, revertedAt: a.revertedAt } : null;
  }

  async markApplyReverted(id: string) {
    const a = this.applies.find((x) => x.id === id);
    if (a) a.revertedAt = Date.now();
  }
}

/** 作り直しの呼び出しを数えるだけの偽物 */
function fakeRebuilder(): MonthlyPlRebuilder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async execute({ yearMonth }) {
      calls.push(yearMonth);
      return { vehicleCount: 1 };
    },
  };
}

const EDIT: MasterEditInput = {
  targetKind: "vehicle",
  targetKey: "101",
  targetLabel: "車番 101",
  field: "lease",
  fieldLabel: "リース料",
  beforeValue: "100000",
  afterValue: "120000",
};

describe("マスタを直したときの反映範囲", () => {
  it("まだ締めていない月には自動で反映される", async () => {
    const history = new MemoryHistoryRepo([
      { yearMonth: "2026-04", total: 5, confirmed: 5 },
      { yearMonth: "2026-05", total: 5, confirmed: 0 },
      { yearMonth: "2026-06", total: 5, confirmed: 2 },
    ]);
    const rebuilder = fakeRebuilder();
    const result = await new ApplyMasterChangeUseCase(history, rebuilder).execute({
      edits: [EDIT],
      actor: ACTOR,
    });

    expect(result.appliedYearMonths).toEqual(["2026-05", "2026-06"]);
    expect(rebuilder.calls).toEqual(["2026-05", "2026-06"]);
  });

  it("確定済みの月は据え置かれ、作り直されない", async () => {
    const history = new MemoryHistoryRepo([
      { yearMonth: "2026-04", total: 5, confirmed: 5 },
      { yearMonth: "2026-05", total: 5, confirmed: 0 },
    ]);
    const rebuilder = fakeRebuilder();
    const result = await new ApplyMasterChangeUseCase(history, rebuilder).execute({
      edits: [EDIT],
      actor: ACTOR,
    });

    expect(result.heldBackYearMonths).toEqual(["2026-04"]);
    expect(rebuilder.calls).not.toContain("2026-04");
  });

  it("直した内容は履歴に残る", async () => {
    const history = new MemoryHistoryRepo([{ yearMonth: "2026-05", total: 1, confirmed: 0 }]);
    await new ApplyMasterChangeUseCase(history, fakeRebuilder()).execute({
      edits: [EDIT],
      actor: ACTOR,
    });
    expect(history.edits[0]).toMatchObject({ fieldLabel: "リース料", beforeValue: "100000", afterValue: "120000" });
  });

  it("その月にしか効かない直しは、その月だけを作り直す", async () => {
    const history = new MemoryHistoryRepo([
      { yearMonth: "2026-05", total: 5, confirmed: 0 },
      { yearMonth: "2026-06", total: 5, confirmed: 0 },
    ]);
    const rebuilder = fakeRebuilder();
    await new ApplyMasterChangeUseCase(history, rebuilder).execute({
      edits: [EDIT],
      actor: ACTOR,
      onlyYearMonth: "2026-05",
    });
    expect(rebuilder.calls).toEqual(["2026-05"]);
  });

  it("率マスタの月別値だけがその月限定と判定される", () => {
    expect(onlyYearMonthOfRateEdit({ targetKind: "rate", targetKey: "admin_rate|2026-05" })).toBe("2026-05");
    expect(onlyYearMonthOfRateEdit({ targetKind: "rate", targetKey: "admin_rate|" })).toBeNull();
    expect(onlyYearMonthOfRateEdit({ targetKind: "vehicle", targetKey: "101" })).toBeNull();
  });
});

describe("据え置いた月の食い違いを見せる", () => {
  it("確定済みの月がいまのマスタと違えば一覧に出る", async () => {
    const history = new MemoryHistoryRepo([{ yearMonth: "2026-04", total: 1, confirmed: 1 }]);
    const stored = [plRow({ no: "101", lease: 100000, profit: 50000 })];
    const previewer: MonthlyPlPreviewer = {
      async preview() {
        return [plRow({ no: "101", lease: 120000, profit: 30000 })];
      },
    };

    const status = await new GetMasterChangeStatusUseCase(
      history,
      stubVehiclePlRepo({ "2026-04": stored }, ["2026-04"]),
      previewer,
    ).execute();

    expect(status.months).toHaveLength(1);
    expect(status.months[0]?.yearMonth).toBe("2026-04");
    expect(status.months[0]?.profitDelta).toBe(-20000);
    const change = status.months[0]?.rows[0]?.changes.find((c) => c.field === "lease");
    expect(change).toMatchObject({ before: 100000, after: 120000, primary: true });
  });

  it("いまのマスタと同じ月は一覧に出ない", async () => {
    const history = new MemoryHistoryRepo([{ yearMonth: "2026-04", total: 1, confirmed: 1 }]);
    const rows = [plRow({ no: "101", lease: 100000 })];
    const status = await new GetMasterChangeStatusUseCase(
      history,
      stubVehiclePlRepo({ "2026-04": rows }, ["2026-04"]),
      { async preview() { return [plRow({ no: "101", lease: 100000 })]; } },
    ).execute();
    expect(status.months).toHaveLength(0);
  });

  it("まだ締めていない月は食い違いの一覧に出ない (自動で反映済みのため)", async () => {
    const history = new MemoryHistoryRepo([{ yearMonth: "2026-05", total: 1, confirmed: 0 }]);
    const status = await new GetMasterChangeStatusUseCase(
      history,
      stubVehiclePlRepo({ "2026-05": [plRow({ no: "101", lease: 100000 })] }),
      { async preview() { return [plRow({ no: "101", lease: 999999 })]; } },
    ).execute();
    expect(status.months).toHaveLength(0);
  });
});

describe("確定済みの月へ反映する / 取り消す", () => {
  let history: MemoryHistoryRepo;
  let plRepo: ReturnType<typeof stubVehiclePlRepo>;
  let byMonth: Record<string, VehiclePlCalculated[]>;

  beforeEach(() => {
    history = new MemoryHistoryRepo([{ yearMonth: "2026-04", total: 1, confirmed: 1 }]);
    byMonth = { "2026-04": [plRow({ no: "101", lease: 100000, profit: 50000 })] };
    plRepo = stubVehiclePlRepo(byMonth, ["2026-04"]);
  });

  const previewer: MonthlyPlPreviewer = {
    async preview() {
      return [plRow({ no: "101", lease: 120000, profit: 30000 })];
    },
  };

  it("反映ボタンで、その月だけが作り直される", async () => {
    const rebuilder = fakeRebuilder();
    const { applyId, summary } = await new ApplyToConfirmedMonthUseCase(
      history,
      plRepo,
      previewer,
      rebuilder,
    ).execute({ yearMonth: "2026-04", actor: ACTOR });

    expect(rebuilder.calls).toEqual(["2026-04"]);
    expect(summary.vehicleCount).toBe(1);
    expect(applyId).toBeTruthy();
    // 反映しても「締めた月である」ことは外れない
    expect(await plRepo.getConfirmation("2026-04")).toEqual({ total: 1, confirmed: 1 });
  });

  it("反映の直前の姿が控えとして残る", async () => {
    await new ApplyToConfirmedMonthUseCase(history, plRepo, previewer, fakeRebuilder()).execute({
      yearMonth: "2026-04",
      actor: ACTOR,
    });
    expect(history.applies[0]?.snapshot[0]?.lease).toBe(100000);
    expect(history.applies[0]?.summary).toBe("1台の数字が変わりました");
  });

  it("まだ締めていない月に対しては、その旨を知らせて何もしない", async () => {
    history.setMonths([{ yearMonth: "2026-05", total: 1, confirmed: 0 }]);
    await expect(
      new ApplyToConfirmedMonthUseCase(history, plRepo, previewer, fakeRebuilder()).execute({
        yearMonth: "2026-05",
        actor: ACTOR,
      }),
    ).rejects.toThrow("確定済みではありません");
  });

  it("違いが無い月には反映しない", async () => {
    await expect(
      new ApplyToConfirmedMonthUseCase(
        history,
        plRepo,
        { async preview() { return [plRow({ no: "101", lease: 100000, profit: 50000 })]; } },
        fakeRebuilder(),
      ).execute({ yearMonth: "2026-04", actor: ACTOR }),
    ).rejects.toThrow("反映するものがありません");
  });

  it("取り消すと反映前の数字に戻る", async () => {
    const { applyId } = await new ApplyToConfirmedMonthUseCase(
      history,
      plRepo,
      previewer,
      fakeRebuilder(),
    ).execute({ yearMonth: "2026-04", actor: ACTOR });

    // 作り直された後の姿にしておく
    byMonth["2026-04"] = [plRow({ no: "101", lease: 120000, profit: 30000 })];

    const reverted = await new RevertConfirmedMonthApplyUseCase(history, {
      ...plRepo,
      upsertMany: async (ym, rows) => {
        byMonth[ym] = [...rows];
      },
      removeVehicles: async (ym, nos) => {
        byMonth[ym] = (byMonth[ym] ?? []).filter((r) => !nos.includes(r.no));
      },
    }).execute({ applyId, actor: ACTOR });

    expect(reverted).toEqual({ yearMonth: "2026-04", restoredCount: 1 });
    expect(byMonth["2026-04"]?.[0]?.lease).toBe(100000);
    expect(history.applies[0]?.revertedAt).not.toBeNull();
  });

  it("同じ反映を二度取り消せない", async () => {
    const { applyId } = await new ApplyToConfirmedMonthUseCase(
      history,
      plRepo,
      previewer,
      fakeRebuilder(),
    ).execute({ yearMonth: "2026-04", actor: ACTOR });
    const usecase = new RevertConfirmedMonthApplyUseCase(history, {
      ...plRepo,
      upsertMany: async () => {},
      removeVehicles: async () => {},
    });
    await usecase.execute({ applyId, actor: ACTOR });
    await expect(usecase.execute({ applyId, actor: ACTOR })).rejects.toThrow("すでに取り消されています");
  });
});

describe("直しそのものを元に戻す", () => {
  it("直す前の値がマスタに書き戻され、反映の規則は直したときと同じになる", async () => {
    const history = new MemoryHistoryRepo([
      { yearMonth: "2026-04", total: 1, confirmed: 1 },
      { yearMonth: "2026-05", total: 1, confirmed: 0 },
    ]);
    const rebuilder = fakeRebuilder();
    const applier = new ApplyMasterChangeUseCase(history, rebuilder);
    await applier.execute({ edits: [EDIT], actor: ACTOR });
    const editId = history.edits[0]!.id;

    const written: { field: string; value: string | null }[] = [];
    const { record, result } = await new UndoMasterEditUseCase(
      history,
      { async write(input) { written.push({ field: input.field, value: input.value }); } },
      applier,
    ).execute({ editId, actor: ACTOR });

    expect(written).toEqual([{ field: "lease", value: "100000" }]);
    expect(record.undoneAt).not.toBeNull();
    // 元に戻したあとも、確定済みの月は据え置かれる
    expect(result.appliedYearMonths).toEqual(["2026-05"]);
    expect(result.heldBackYearMonths).toEqual(["2026-04"]);
  });

  it("同じ直しを二度は戻せない", async () => {
    const history = new MemoryHistoryRepo([{ yearMonth: "2026-05", total: 1, confirmed: 0 }]);
    const applier = new ApplyMasterChangeUseCase(history, fakeRebuilder());
    await applier.execute({ edits: [EDIT], actor: ACTOR });
    const editId = history.edits[0]!.id;
    const usecase = new UndoMasterEditUseCase(history, { async write() {} }, applier);
    await usecase.execute({ editId, actor: ACTOR });
    await expect(usecase.execute({ editId, actor: ACTOR })).rejects.toThrow("すでに元に戻されています");
  });
});
