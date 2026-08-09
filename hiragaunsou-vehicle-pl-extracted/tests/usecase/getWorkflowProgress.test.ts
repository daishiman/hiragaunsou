import { describe, expect, it } from "vitest";
import { GetWorkflowProgressUseCase } from "../../src/usecase/steps/getWorkflowProgress";
import {
  manualInput,
  stubImportBatchRepo,
  stubManualInputRepo,
  stubReviewFlagRepo,
  stubCleansingDecisionRepo,
  stubVehiclePlRepo,
} from "../fixtures/stubRepositories";
import { plRow } from "../fixtures/vehiclePlRow";
import { CLEANSING_SOURCE_TYPE } from "../../src/usecase/steps/getCleansingQueue";

const YM = "2026-05";

function useCase(opts: {
  batches?: Parameters<typeof stubImportBatchRepo>[0];
  manualInputs?: ReturnType<typeof manualInput>[];
  vehicleCount?: number;
  openFlags?: Parameters<typeof stubReviewFlagRepo>[0];
  cleansingDecisions?: Parameters<typeof stubCleansingDecisionRepo>[0];
  /** STEP8 の確定操作が済んでいるか */
  confirmed?: boolean;
  /** rate_master に入っているキリンの協力金の合計 */
  kirinAmount?: number;
}) {
  const rows = Array.from({ length: opts.vehicleCount ?? 0 }, (_, i) =>
    plRow({ no: String(i + 1) }),
  );
  return new GetWorkflowProgressUseCase(
    stubImportBatchRepo(opts.batches ?? {}),
    stubManualInputRepo(opts.manualInputs ?? []),
    stubVehiclePlRepo({ [YM]: rows }, opts.confirmed ? [YM] : []),
    stubReviewFlagRepo(opts.openFlags ?? []),
    stubCleansingDecisionRepo(opts.cleansingDecisions ?? []),
    async () => opts.kirinAmount ?? 0,
  );
}

const ALL_IMPORTED = {
  [`${YM}:vehicle_operation`]: { fileName: "運行実績.csv", rowCount: 100 },
  [`${YM}:sales_monitor`]: { fileName: "売上モニタリスト.csv", rowCount: 200 },
  [`${YM}:payroll`]: { fileName: "給与集計表.csv", rowCount: 40 },
};

describe("GetWorkflowProgressUseCase", () => {
  it("業務フローの8ステップをすべて返す", async () => {
    const result = await useCase({}).execute(YM);
    expect(result.totalCount).toBe(8);
    expect(result.steps.map((s) => s.step.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("何も取り込んでいなければ STEP1 が次にやること", async () => {
    const result = await useCase({}).execute(YM);
    expect(result.nextStep?.step.id).toBe(1);
    expect(result.doneCount).toBe(0);
    expect(result.isComplete).toBe(false);
  });

  it("取込前は手入力・確認のステップに着手できない(blocked)", async () => {
    const result = await useCase({}).execute(YM);
    const blocked = result.steps.filter((s) => s.blocked).map((s) => s.step.id);
    expect(blocked).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("売上を取り込んでもキリン配賦が未入力なら STEP2 は入力途中", async () => {
    const result = await useCase({ batches: ALL_IMPORTED, vehicleCount: 3 }).execute(YM);
    const step2 = result.steps.find((s) => s.step.id === 2)!;
    expect(step2.status).toBe("partial");
    expect(step2.detail).toContain("キリン");
  });

  it("キリンの配賦が入っていれば STEP2 は完了", async () => {
    const result = await useCase({
      batches: ALL_IMPORTED,
      vehicleCount: 3,
      manualInputs: [manualInput("24", { miscOther: 500_000 })],
    }).execute(YM);
    expect(result.steps.find((s) => s.step.id === 2)!.status).toBe("done");
  });

  it("燃料費が一部の車両だけなら STEP3 は入力途中で、台数が出る", async () => {
    const result = await useCase({
      batches: ALL_IMPORTED,
      vehicleCount: 3,
      manualInputs: [manualInput("1", { fuelInQty: 500 })],
    }).execute(YM);
    const step3 = result.steps.find((s) => s.step.id === 3)!;
    expect(step3.status).toBe("partial");
    expect(step3.detail).toContain("3台中 1台");
  });

  it("高速料金は実費0円の入力も「入力済み」として数える(未入力と区別する)", async () => {
    const result = await useCase({
      batches: ALL_IMPORTED,
      vehicleCount: 1,
      manualInputs: [manualInput("1", { tollActual: 0, tollDiscountActual: 0 })],
    }).execute(YM);
    expect(result.steps.find((s) => s.step.id === 6)!.status).toBe("done");
  });

  it("未判定の異常値があれば STEP7 は入力途中、STEP8 は未着手", async () => {
    const result = await useCase({
      batches: ALL_IMPORTED,
      vehicleCount: 1,
      openFlags: [
        {
          id: "f1",
          vehicleNo: "1",
          field: "repair",
          type: "digit_suspect",
          severity: "warning",
          message: "桁ミスの疑い",
          monthlyReference: null,
        },
      ] as Parameters<typeof stubReviewFlagRepo>[0],
    }).execute(YM);
    expect(result.steps.find((s) => s.step.id === 7)!.status).toBe("partial");
    expect(result.steps.find((s) => s.step.id === 8)!.status).toBe("todo");
  });

  it("チェックが済んでも確定するまで STEP8 は完了にしない", async () => {
    const result = await useCase({
      batches: ALL_IMPORTED,
      vehicleCount: 1,
      manualInputs: [
        manualInput("1", {
          fuelInQty: 500,
          repairActual: 1000,
          tollActual: 2000,
          miscOther: 500_000,
        }),
      ],
    }).execute(YM);
    expect(result.steps.find((s) => s.step.id === 7)!.status).toBe("done");
    expect(result.steps.find((s) => s.step.id === 8)!.status).toBe("todo");
    expect(result.nextStep?.step.id).toBe(8);
  });

  it("すべて終わっていれば nextStep は null になる", async () => {
    const result = await useCase({
      batches: ALL_IMPORTED,
      vehicleCount: 1,
      confirmed: true,
      manualInputs: [
        manualInput("1", {
          fuelInQty: 500,
          repairActual: 1000,
          tollActual: 2000,
          miscOther: 500_000,
        }),
      ],
    }).execute(YM);
    expect(result.nextStep).toBeNull();
    expect(result.isComplete).toBe(true);
    expect(result.doneCount).toBe(8);
  });

  it("キリンの協力金は保存先(rate_master)の金額で入力済みと判定する", async () => {
    // 手入力画面は miscOther に書き込まないため、miscOther を見ている限り
    // いくら入力しても STEP2 が「キリンの配賦がまだです」のままだった。
    const withoutKirin = await useCase({
      batches: ALL_IMPORTED,
      vehicleCount: 1,
      manualInputs: [manualInput("1", {})],
    }).execute(YM);
    expect(withoutKirin.steps.find((s) => s.step.id === 2)?.status).toBe("partial");

    const withKirin = await useCase({
      batches: ALL_IMPORTED,
      vehicleCount: 1,
      manualInputs: [manualInput("1", {})],
      kirinAmount: 500_000,
    }).execute(YM);
    expect(withKirin.steps.find((s) => s.step.id === 2)?.status).toBe("done");
  });

  it("備品費・メンテ費だけが残っていてもSTEP5を入力済みと数えない", async () => {
    // 入力欄を廃止した項目の古い値で、修繕費もタイヤ代も未入力の車両が「済」に見えてしまうのを防ぐ。
    const result = await useCase({
      batches: ALL_IMPORTED,
      vehicleCount: 1,
      manualInputs: [manualInput("1", { equip: 3000, mainte: 2000 })],
    }).execute(YM);
    expect(result.steps.find((s) => s.step.id === 5)?.status).toBe("todo");
  });

  describe("続きができる画面(href)への差し替え", () => {
    it("取込前は各ステップの入口をそのまま指す", async () => {
      const result = await useCase({}).execute(YM);
      const step2 = result.steps.find((s) => s.step.id === 2)!;
      expect(step2.href).toBe(step2.step.href);
      expect(step2.actionLabel).toBeNull();
    });

    it("売上を取り込んだあと要確認が残っていれば、取込画面ではなくデータ整形へ送る", async () => {
      // 取込済みの画面へ戻されると「もう取り込んだのに何をすればいいのか」で止まる。
      const result = await useCase({
        batches: {
          ...ALL_IMPORTED,
          [`${YM}:${CLEANSING_SOURCE_TYPE}`]: {
            fileName: "売上モニタリスト.csv",
            rowCount: 200,
            flaggedRowCount: 5,
          },
        },
        vehicleCount: 3,
        cleansingDecisions: [],
      }).execute(YM);
      const step2 = result.steps.find((s) => s.step.id === 2)!;
      expect(step2.href).toBe("/cleansing");
      expect(step2.actionLabel).toBe("傭車・2重計上・諸口を判断する");
    });

    it("整形が済んでキリンの配賦だけが残っていれば、手入力のキリン配賦へ送る", async () => {
      const result = await useCase({ batches: ALL_IMPORTED, vehicleCount: 3 }).execute(YM);
      const step2 = result.steps.find((s) => s.step.id === 2)!;
      expect(step2.href).toBe("/manual-entry?step=2");
      expect(step2.actionLabel).toBe("キリンの協力金を入力する");
    });

    it("キリンの配賦まで済んでいればSTEP2は差し替えない", async () => {
      const result = await useCase({
        batches: ALL_IMPORTED,
        vehicleCount: 3,
        kirinAmount: 500_000,
      }).execute(YM);
      const step2 = result.steps.find((s) => s.step.id === 2)!;
      expect(step2.href).toBe(step2.step.href);
      expect(step2.actionLabel).toBeNull();
    });
  });

  describe("収支表が0台のときの理由", () => {
    it("取込前は「先に取込が必要」と伝える", async () => {
      const result = await useCase({}).execute(YM);
      expect(result.steps.find((s) => s.step.id === 3)!.detail).toContain("先に運行実績・売上の取込が必要です");
    });

    it("取込済みで0台なら、取込を促さず車両マスタを確認するよう伝える", async () => {
      // 取り込んだ人に「先に取込が必要」と出すと、何をしても進まない画面に見える。
      const result = await useCase({ batches: ALL_IMPORTED, vehicleCount: 0 }).execute(YM);
      const detail = result.steps.find((s) => s.step.id === 3)!.detail;
      expect(detail).toContain("車両マスタ");
      expect(detail).not.toContain("先に運行実績・売上の取込が必要です");
    });
  });
});
