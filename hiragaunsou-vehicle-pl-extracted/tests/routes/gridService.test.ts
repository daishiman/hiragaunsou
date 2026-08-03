import { describe, expect, it } from "vitest";
import { buildGridResponse } from "../../src/server/routes/gridService";
import type { AnomalyFlag } from "../../src/server/calc/anomaly";

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
