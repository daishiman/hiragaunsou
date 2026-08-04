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

const YM = "2026-05";

function useCase(opts: {
  batches?: Parameters<typeof stubImportBatchRepo>[0];
  manualInputs?: ReturnType<typeof manualInput>[];
  vehicleCount?: number;
  openFlags?: Parameters<typeof stubReviewFlagRepo>[0];
  cleansingDecisions?: Parameters<typeof stubCleansingDecisionRepo>[0];
  /** STEP8 の確定操作が済んでいるか */
  confirmed?: boolean;
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
});
