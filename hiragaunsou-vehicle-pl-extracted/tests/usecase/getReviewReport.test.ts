import { describe, expect, it } from "vitest";
import { buildGridResponse } from "../../src/usecase/steps/getMonthlyGrid";
import { buildReviewReport } from "../../src/usecase/steps/getReviewReport";
import type { PlIssueAckRecord } from "../../src/domain/rules/plIssueAck";
import type { VehiclePlOverrideRecord } from "../../src/domain/repositories/VehiclePlOverrideRepository";

/**
 * 確認結果の記録 (印刷・共有用) を検証する。
 *
 * この紙は月次の締めで上長・経理に渡すもので、「誰がいつ何を判断したか」が
 * 抜けると渡す意味が無くなる。判断の種類ごとの振り分けと、判断者・日時が
 * 落ちないことを固定する。
 */

/** 稼働しているのに売上が0 → 「要修正」の指摘が立つ最小の行 */
function activeRowWithoutSales(vehicleNo: string) {
  return { vehicleNo, type: "4t", km: 1_000, trips: 10, hours: 100, sales: 0, salary: 300_000 };
}

function ack(over: Partial<PlIssueAckRecord> = {}): PlIssueAckRecord {
  return {
    vehicleNo: "10",
    field: "sales",
    code: "sales_unlinked",
    status: "ok",
    note: null,
    valueAtAck: 0,
    ackedAt: new Date(2026, 5, 1, 9, 0, 0),
    ackedByName: "今西",
    ...over,
  };
}

function override(over: Partial<VehiclePlOverrideRecord> = {}): VehiclePlOverrideRecord {
  return {
    vehicleNo: "10",
    excluded: false,
    values: { fare: 900_000 },
    reason: "請求側の調整",
    updatedAt: new Date(2026, 5, 1, 10, 0, 0),
    updatedByName: "今西",
    appliedAt: new Date(2026, 5, 1, 10, 5, 0),
    ...over,
  };
}

function report(
  acks: PlIssueAckRecord[] = [],
  overrides: VehiclePlOverrideRecord[] = [],
  vehicles = ["10", "11"],
) {
  const grid = buildGridResponse(
    "2026-05",
    vehicles.map(activeRowWithoutSales),
    [],
    undefined,
    overrides,
    acks,
  );
  return buildReviewReport(grid, {
    generatedAt: new Date(2026, 5, 2, 8, 0, 0).getTime(),
    generatedByName: "山田",
    isConfirmed: false,
  });
}

describe("buildReviewReport", () => {
  it("判断の種類ごとに指摘を振り分ける", () => {
    const result = report([ack(), ack({ vehicleNo: "11", status: "later" })]);

    expect(result.okItems.some((i) => i.vehicleNo === "10" && i.code === "sales_unlinked")).toBe(
      true,
    );
    expect(
      result.postponedItems.some((i) => i.vehicleNo === "11" && i.code === "sales_unlinked"),
    ).toBe(true);
    // 判断済みの指摘が「まだ確認していない」側に二重で出ないこと
    expect(result.openItems.some((i) => i.code === "sales_unlinked")).toBe(false);
  });

  it("誰がいつ判断したかを残す(これが無いと共有する意味が無くなる)", () => {
    const item = report([ack()]).okItems.find((i) => i.code === "sales_unlinked");

    expect(item?.judgedByName).toBe("今西");
    expect(item?.judgedAt).toBe(new Date(2026, 5, 1, 9, 0, 0).getTime());
  });

  it("まだ判断していない指摘には判断者も日時も入らない", () => {
    const item = report().openItems.find((i) => i.code === "sales_unlinked");

    expect(item?.judgedByName).toBeNull();
    expect(item?.judgedAt).toBeNull();
  });

  it("人が直した数字を、項目・理由・直した人と一緒に残す", () => {
    const fix = report([], [override()]).fixes.find((f) => f.vehicleNo === "10");

    expect(fix?.entries).toEqual([{ field: "fare", value: 900_000 }]);
    expect(fix?.reason).toBe("請求側の調整");
    expect(fix?.updatedByName).toBe("今西");
    expect(fix?.pending).toBe(false);
  });

  /** 反映していない直しを「直した」とだけ書くと、紙と収支表の数字が食い違う。 */
  it("まだ収支表に反映していない直しには反映待ちの印を付ける", () => {
    const fix = report([], [override({ appliedAt: null })]).fixes.find((f) => f.vehicleNo === "10");
    expect(fix?.pending).toBe(true);
  });

  it("重い指摘から順に並べる(紙を上から読めば重要なものが先に来る)", () => {
    const severities = report().openItems.map((i) => i.severity);
    const order = { blocking: 0, warning: 1, info: 2 } as const;
    const sorted = [...severities].sort((a, b) => order[a] - order[b]);
    expect(severities).toEqual(sorted);
  });

  it("いつ時点の紙かと、出した人を必ず持つ", () => {
    const result = report();
    expect(result.generatedByName).toBe("山田");
    expect(result.generatedAt).toBe(new Date(2026, 5, 2, 8, 0, 0).getTime());
  });
});
