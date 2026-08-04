import { describe, expect, it } from "vitest";
import { applyCleansingDecisions } from "../../src/usecase/steps/getCleansingQueue";
import {
  aggregateSalesByVehicle,
  slipKey,
  type SalesMonitorRow,
} from "../../src/infrastructure/parsers/salesMonitorParser";
import type { CleansingDecisionRecord } from "../../src/domain/repositories/CleansingDecisionRepository";

function row(overrides: Partial<SalesMonitorRow> = {}): SalesMonitorRow {
  return {
    vehicleCode: "24",
    driverName: "山田",
    fare: 100000,
    toll: 0,
    ancillaryFee: 0,
    isChartered: false,
    needsReview: false,
    reviewReason: null,
    slipNo: "S001",
    lineNo: "1",
    customerName: "キリン",
    loadDate: "2026-05-01",
    ...overrides,
  };
}

function decision(overrides: Partial<CleansingDecisionRecord>): CleansingDecisionRecord {
  return {
    yearMonth: "2026-05",
    sourceType: "sales_monitor",
    rowKey: "S001-1",
    vehicleNo: "24",
    driverName: "諸口",
    flagTypes: ["misc_entry"],
    decision: "keep",
    correctedVehicleNo: null,
    note: null,
    ...overrides,
  };
}

describe("slipKey (伝票の自然キー)", () => {
  it("管理№と行№から作る(再取込しても同じキーになる)", () => {
    expect(slipKey(row({ slipNo: "S123", lineNo: "4" }), 0)).toBe("S123-4");
  });

  it("管理№が取れない古い取込データは車番+行番号へフォールバックする", () => {
    expect(slipKey({ vehicleCode: "24" }, 7)).toBe("24#7");
  });
});

describe("applyCleansingDecisions (STEP1の判断を集計へ反映する)", () => {
  it("判断が無ければ伝票をそのまま返す", () => {
    const rows = [row(), row({ slipNo: "S002" })];
    expect(applyCleansingDecisions(rows, [])).toEqual(rows);
  });

  it("「除外する」と判断した伝票は落とす", () => {
    const rows = [row(), row({ slipNo: "S002" })];
    const result = applyCleansingDecisions(rows, [decision({ decision: "delete" })]);
    expect(result).toHaveLength(1);
    expect(result[0]?.slipNo).toBe("S002");
  });

  it("「修正して残す」は指定した車番へ付け替える", () => {
    const result = applyCleansingDecisions(
      [row({ vehicleCode: "888" })],
      [decision({ decision: "correct", correctedVehicleNo: "300" })],
    );
    expect(result[0]?.vehicleCode).toBe("300");
    expect(result[0]?.fare).toBe(100000);
  });

  it("「修正して残す」でも付け替え先が無ければ元のまま残す(勝手に消さない)", () => {
    const result = applyCleansingDecisions(
      [row({ vehicleCode: "888" })],
      [decision({ decision: "correct", correctedVehicleNo: null })],
    );
    expect(result[0]?.vehicleCode).toBe("888");
  });

  it("「そのまま残す」は何もしない", () => {
    const result = applyCleansingDecisions([row()], [decision({ decision: "keep" })]);
    expect(result).toHaveLength(1);
  });

  it("除外した伝票の売上は車番別集計から消える", () => {
    const rows = [row({ fare: 100000 }), row({ slipNo: "S002", fare: 30000 })];
    const kept = applyCleansingDecisions(rows, [decision({ decision: "delete" })]);
    expect(aggregateSalesByVehicle(kept).get("24")?.fare).toBe(30000);
  });

  it("付け替えた売上は付け替え先の車番へ集計される", () => {
    const rows = [row({ vehicleCode: "888", fare: 50000 })];
    const kept = applyCleansingDecisions(rows, [
      decision({ decision: "correct", correctedVehicleNo: "300" }),
    ]);
    const agg = aggregateSalesByVehicle(kept);
    expect(agg.get("300")?.fare).toBe(50000);
    expect(agg.get("888")).toBeUndefined();
  });
});
