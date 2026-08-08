import { describe, expect, it, vi } from "vitest";
import { RecalculateMonthlyPlUseCase } from "../../src/usecase/steps/recalculateMonthlyPl";
import type { ManualInputRecord, ManualInputRepository } from "../../src/domain/repositories/ManualInputRepository";
import type {
  AppSettingRepository,
  CleansingDecisionRecord,
  CleansingDecisionRepository,
} from "../../src/domain/repositories/CleansingDecisionRepository";
import type { RateMasterRepository } from "../../src/domain/repositories/MasterRepository";
import type {
  VehiclePlOverrideRecord,
  VehiclePlOverrideRepository,
} from "../../src/domain/repositories/VehiclePlOverrideRepository";

interface Stubs {
  manualInputs?: ManualInputRecord[];
  decisions?: CleansingDecisionRecord[];
  kirinTargets?: string | null;
  rates?: Record<string, number>;
  overrides?: VehiclePlOverrideRecord[];
}

function build(stubs: Stubs = {}) {
  const manualInputRepo: ManualInputRepository = {
    findByYearMonth: async () => stubs.manualInputs ?? [],
    upsertMany: async () => undefined,
  };
  const cleansingRepo = {
    findByYearMonth: async () => stubs.decisions ?? [],
  } as unknown as CleansingDecisionRepository;
  const appSettingRepo: AppSettingRepository = {
    get: async () => stubs.kirinTargets ?? null,
    set: async () => undefined,
  };
  const rateMasterRepo = {
    getRate: async (key: string, _yearMonth: string, fallback: number) => stubs.rates?.[key] ?? fallback,
  } as unknown as RateMasterRepository;

  const overrideRepo: VehiclePlOverrideRepository = {
    findByYearMonth: async () => stubs.overrides ?? [],
    save: async () => undefined,
    remove: async () => undefined,
  };

  const finalize = vi.fn(async () => ({ yearMonth: "2026-05", vehicleCount: 96, rows: [] }));
  const useCase = new RecalculateMonthlyPlUseCase(
    manualInputRepo,
    cleansingRepo,
    appSettingRepo,
    rateMasterRepo,
    overrideRepo,
    { execute: finalize },
  );
  return { useCase, finalize };
}

describe("RecalculateMonthlyPlUseCase", () => {
  /**
   * このユースケースの存在理由そのもの。以前は呼び出し側(手入力API・リース料API・Excel取込)が
   * 材料を各自で集めており、リース料APIだけがキリン配賦を渡し忘れていた。
   * その結果「リース料を1台直すと24番・300番への配賦が全部消える」という副作用が出ていた。
   * 年月だけを引数にして、渡し忘れが起こせない形になっていることを確認する。
   */
  it("年月だけを渡せば、手入力・整形判断・キリン配賦をすべて集めて再計算する", async () => {
    const manualInputs = [{ vehicleNo: "10" } as ManualInputRecord];
    const decisions = [{ rowKey: "S-1-1", decision: "delete" } as CleansingDecisionRecord];
    const { useCase, finalize } = build({
      manualInputs,
      decisions,
      rates: { kirin_transport_support: 600000, kirin_management_support: 400000 },
    });

    await useCase.execute({ yearMonth: "2026-05" });

    expect(finalize).toHaveBeenCalledWith({
      yearMonth: "2026-05",
      manualInputs,
      cleansingDecisions: decisions,
      kirinAllocations: [
        { vehicleNo: "24", amount: 500000 },
        { vehicleNo: "300", amount: 500000 },
      ],
      overrides: [],
    });
  });

  /**
   * 上書きは保存されていても、再計算時に読み直されなければ次の確定で静かに消える。
   * 「毎月同じ手直しを人がやり直す」状態に戻らないよう、材料に含まれることを固定する。
   */
  it("保存済みの車両単位の上書きを読み直して再計算に渡す", async () => {
    const overrides = [
      {
        vehicleNo: "10",
        excluded: false,
        values: { fare: 900000 },
        reason: "請求側の調整",
        updatedAt: new Date(0),
        updatedByName: "今西",
      },
    ];
    const { useCase, finalize } = build({ overrides });

    await useCase.execute({ yearMonth: "2026-05" });

    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ overrides }));
  });

  it("キリンの受取額が未設定の月は配賦を作らない", async () => {
    const { useCase, finalize } = build();

    await useCase.execute({ yearMonth: "2026-05" });

    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ kirinAllocations: [] }));
  });

  it("配賦先車番は設定を優先する(専属車両が変わっても既定の2台に戻らない)", async () => {
    const { useCase, finalize } = build({
      kirinTargets: "11, 22 ,33",
      rates: { kirin_transport_support: 900 },
    });

    await useCase.execute({ yearMonth: "2026-05" });

    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        kirinAllocations: [
          { vehicleNo: "11", amount: 300 },
          { vehicleNo: "22", amount: 300 },
          { vehicleNo: "33", amount: 300 },
        ],
      }),
    );
  });
});
