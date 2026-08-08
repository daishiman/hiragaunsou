import { describe, expect, it } from "vitest";
import { buildGridResponse } from "../../src/usecase/steps/getMonthlyGrid";
import type { AnomalyFlag } from "../../src/domain/rules/anomalyDetection";

describe("buildGridResponse", () => {
  it("51列すべてをfieldsとして返す", () => {
    const res = buildGridResponse("2026-05", [], []);
    expect(res.fields).toHaveLength(51);
    expect(res.fields).toContain("profit");
    expect(res.fields).toContain("margin");
  });

  it("データが無い場合 isEmpty=true", () => {
    const res = buildGridResponse("2026-05", [], []);
    expect(res.isEmpty).toBe(true);
  });

  it("異常検知フラグの対象フィールドを highlightedFields に反映する", () => {
    const flags: AnomalyFlag[] = [
      {
        vehicleNo: "1",
        field: "repair",
        type: "digit_suspect",
        message: "桁ミス疑い",
        monthlyReference: 1000,
        value: 999999,
      },
    ];
    const res = buildGridResponse(
      "2026-05",
      [{ vehicleNo: "1", repair: 999999 }],
      flags,
    );
    expect(res.rows[0].highlightedFields).toEqual(["repair"]);
  });

  it("フラグの無い車両はhighlightedFieldsが空配列", () => {
    const res = buildGridResponse("2026-05", [{ vehicleNo: "2" }], []);
    expect(res.rows[0].highlightedFields).toEqual([]);
  });
});

/**
 * 「確認しました。このままでよい」と判断した指摘は、残りの件数から外れて確認作業が前に進む。
 * 逆に外れないと、直しようのない指摘 (例: 実力として赤字) が毎月ずっと残り続ける。
 */
describe("buildGridResponse の確認済み", () => {
  const flags: AnomalyFlag[] = [
    {
      vehicleNo: "1",
      field: "repair",
      type: "digit_suspect",
      message: "桁ミス疑い",
      monthlyReference: 1000,
      value: 999999,
    },
  ];
  const plRows = [{ vehicleNo: "1", repair: 999999 }];

  it("確認済みにした指摘は残り件数から外れ、確認済みとして数える", () => {
    const before = buildGridResponse("2026-05", plRows, flags);
    const target = before.rows[0].issues[0];
    expect(target).toBeDefined();
    expect(before.review.acknowledged).toBe(0);

    const after = buildGridResponse("2026-05", plRows, flags, undefined, [], [
      {
        vehicleNo: target.vehicleNo,
        field: target.field,
        code: target.code,
        note: null,
        ackedAt: new Date(2026, 4, 20),
        ackedByName: "今西",
      },
    ]);

    const openBefore = before.review.blocking + before.review.warning + before.review.info;
    const openAfter = after.review.blocking + after.review.warning + after.review.info;
    expect(openAfter).toBe(openBefore - 1);
    expect(after.review.acknowledged).toBe(1);
    expect(after.rows[0].issues[0].acknowledged).toBe(true);
    expect(after.rows[0].issues[0].ack?.ackedByName).toBe("今西");
  });

  /** 行の色は「まだ確認していない指摘」で決める。済んだ行が赤いままだと残りが見えなくなる。 */
  it("すべて確認済みになった行は色が付かなくなる", () => {
    const before = buildGridResponse("2026-05", plRows, flags);
    const acks = before.rows[0].issues.map((issue) => ({
      vehicleNo: issue.vehicleNo,
      field: issue.field,
      code: issue.code,
      note: null,
      ackedAt: new Date(2026, 4, 20),
      ackedByName: "今西",
    }));

    const after = buildGridResponse("2026-05", plRows, flags, undefined, [], acks);
    expect(before.rows[0].severity).not.toBeNull();
    expect(after.rows[0].severity).toBeNull();
  });

  /** 直したのに反映していない件数が見えないと、古い数字のまま確定してしまう。 */
  it("収支表へ反映していない直しの件数を返す", () => {
    const res = buildGridResponse("2026-05", plRows, [], undefined, [
      {
        vehicleNo: "1",
        excluded: false,
        values: { repair: 9999 },
        reason: "桁の打ち間違い",
        updatedAt: new Date(2026, 4, 20, 10),
        updatedByName: "今西",
        appliedAt: null,
      },
    ]);

    expect(res.review.pendingOverrides).toBe(1);
    expect(res.rows[0].override?.pending).toBe(true);
    expect(res.rows[0].override?.values).toEqual({ repair: 9999 });
  });

  it("反映済みの直しは反映待ちに数えない", () => {
    const res = buildGridResponse("2026-05", plRows, [], undefined, [
      {
        vehicleNo: "1",
        excluded: false,
        values: { repair: 9999 },
        reason: "桁の打ち間違い",
        updatedAt: new Date(2026, 4, 20, 10),
        updatedByName: "今西",
        appliedAt: new Date(2026, 4, 20, 11),
      },
    ]);

    expect(res.review.pendingOverrides).toBe(0);
    expect(res.rows[0].override?.pending).toBe(false);
  });
});
