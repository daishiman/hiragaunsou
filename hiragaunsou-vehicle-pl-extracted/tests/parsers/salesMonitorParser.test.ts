import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseSalesMonitorCsv,
  aggregateSalesByVehicle,
  slipKey,
} from "../../src/infrastructure/parsers/salesMonitorParser";

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

  it("車両コードが空の行は取込対象から除外する(集計を持たない伝票を混ぜない)", () => {
    const csv = [
      "車両コード,運転者名,受取運賃,通行料,燃料サーチャージ,待機時間料,付帯料金,管理№,行№,荷主先略称,積荷日",
      ',濱田,"1,552,000","250,000","8,000","4,110",0,S001,1,テスト荷主,2026-05-01',
      '22,山田,"800,000","100,000",0,0,0,S002,1,テスト荷主2,2026-05-02',
    ].join("\r\n");

    const rows = parseSalesMonitorCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vehicleCode: "22" });
  });
});

describe("slipKey (伝票1行を一意に指すキー)", () => {
  it("管理№があれば管理№+行№を自然キーにする(再取込・翌月引き継ぎで一致させるため)", () => {
    const key = slipKey({ slipNo: "S001", lineNo: "1", vehicleCode: "22" }, 5);
    expect(key).toBe("S001-1");
  });

  it("管理№が無い古い取込データは、行の並び順(index)にフォールバックする", () => {
    const key = slipKey({ slipNo: "", lineNo: "1", vehicleCode: "22" }, 5);
    expect(key).toBe("22#5");
  });

  it("slipNo自体が無い(undefined)場合もindexへフォールバックする", () => {
    const key = slipKey({ vehicleCode: "22" }, 0);
    expect(key).toBe("22#0");
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

  // 収支表 L列「高速他料金」= 通行料 + その他(燃料サーチャージ+待機時間料+付帯料金)。
  // 現行Excelの「車両別売上」シートがこの2つを足して収支表へ転記している。
  it("附帯料金に顧客請求分の通行料を含める(収支表の高速他料金と同じ定義)", () => {
    const csv = [
      "車両コード,運転者名,受取運賃,通行料,燃料サーチャージ,待機時間料,付帯料金,管理№,行№,荷主先略称,積荷日",
      "22,濱田,\"1,552,000\",\"250,000\",\"8,000\",\"4,110\",0,S001,1,テスト荷主,2026-05-01",
    ].join("\r\n");

    const rows = parseSalesMonitorCsv(csv);
    expect(rows[0].toll).toBe(250000);
    expect(rows[0].ancillaryFee).toBe(262110);
  });

  it("同一車両の複数伝票を合算しslipCountをカウントする", () => {
    const rows = parseSalesMonitorCsv(new Uint8Array(fixture));
    const agg = aggregateSalesByVehicle(rows);
    for (const v of agg.values()) {
      expect(v.slipCount).toBeGreaterThan(0);
    }
  });

  it("列の順番が変わっても列名で解決して取り込める", () => {
    const csv = [
      "積荷日,荷主先略称,行№,管理№,付帯料金,待機時間料,燃料サーチャージ,通行料,受取運賃,運転者名,車両コード",
      "2026-05-01,テスト荷主,1,S001,0,\"4,110\",\"8,000\",\"250,000\",\"1,552,000\",濱田,22",
    ].join("\r\n");

    const rows = parseSalesMonitorCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vehicleCode: "22", driverName: "濱田", fare: 1552000, toll: 250000 });
  });

  it("必須列が1つ欠けていると、欠けている列名を含む例外になる", () => {
    const csv = [
      "車両コード,運転者名,受取運賃,通行料,燃料サーチャージ,待機時間料,管理№,行№,荷主先略称,積荷日",
      "22,濱田,\"1,552,000\",\"250,000\",\"8,000\",\"4,110\",S001,1,テスト荷主,2026-05-01",
    ].join("\r\n");

    expect(() => parseSalesMonitorCsv(csv)).toThrow(/付帯料金/);
  });
});
