import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseSalesMonitorCsv,
  aggregateSalesByVehicle,
} from "../../src/server/parsers/salesMonitorParser";

const fixture = readFileSync(resolve(__dirname, "../fixtures/sales_monitor_sample.csv"));

describe("parseSalesMonitorCsv", () => {
  it("車両コード別に運賃・通行料・附帯料金を数値として取得する", () => {
    const rows = parseSalesMonitorCsv(new Uint8Array(fixture));
    expect(rows.length).toBeGreaterThan(0);
    expect(typeof rows[0].fare).toBe("number");
  });

  it("車両コード88888(傭車)を機械的にフラグする", () => {
    const rows = parseSalesMonitorCsv(new Uint8Array(fixture));
    const chartered = rows.filter((r) => r.vehicleCode === "88888");
    expect(chartered.length).toBeGreaterThan(0);
    expect(chartered.every((r) => r.isChartered)).toBe(true);
  });

  it("運転者名「諸口」の行は自動削除せず要確認フラグを立てる", () => {
    const rows = parseSalesMonitorCsv(new Uint8Array(fixture));
    const misc = rows.filter((r) => r.driverName === "諸口");
    expect(misc.length).toBeGreaterThan(0);
    expect(misc.every((r) => r.needsReview && r.reviewReason)).toBe(true);
  });

  it("通常行はneedsReviewがfalse", () => {
    const rows = parseSalesMonitorCsv(new Uint8Array(fixture));
    const normal = rows.filter(
      (r) => !r.isChartered && r.driverName !== "諸口",
    );
    expect(normal.length).toBeGreaterThan(0);
    expect(normal.every((r) => !r.needsReview)).toBe(true);
  });
});

describe("aggregateSalesByVehicle", () => {
  it("傭車(88888)は集計から自動除外される", () => {
    const rows = parseSalesMonitorCsv(new Uint8Array(fixture));
    const agg = aggregateSalesByVehicle(rows);
    expect(agg.has("88888")).toBe(false);
  });

  it("諸口フラグの車両は集計に含めたうえでhasReviewFlagを立てる(自動削除しない)", () => {
    const rows = parseSalesMonitorCsv(new Uint8Array(fixture));
    const miscRow = rows.find((r) => r.driverName === "諸口" && !r.isChartered);
    expect(miscRow).toBeDefined();
    const agg = aggregateSalesByVehicle(rows);
    const target = agg.get(miscRow!.vehicleCode);
    expect(target).toBeDefined();
    expect(target!.hasReviewFlag).toBe(true);
    expect(target!.toll).toBeGreaterThanOrEqual(miscRow!.toll);
  });

  it("同一車両の複数伝票を合算しslipCountをカウントする", () => {
    const rows = parseSalesMonitorCsv(new Uint8Array(fixture));
    const agg = aggregateSalesByVehicle(rows);
    for (const v of agg.values()) {
      expect(v.slipCount).toBeGreaterThan(0);
    }
  });
});
