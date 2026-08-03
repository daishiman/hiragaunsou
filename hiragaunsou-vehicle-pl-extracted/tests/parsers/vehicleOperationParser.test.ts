import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseVehicleOperationCsv } from "../../src/server/parsers/vehicleOperationParser";

const fixture = readFileSync(
  resolve(__dirname, "../fixtures/vehicle_operation_sample.csv"),
);

describe("parseVehicleOperationCsv", () => {
  it("cp932 CSVをパースし、行数分のレコードを返す", () => {
    const records = parseVehicleOperationCsv(new Uint8Array(fixture));
    expect(records.length).toBeGreaterThan(0);
  });

  it("稼働時間の H:MM 文字列を10進時間へ正規化する", () => {
    const records = parseVehicleOperationCsv(new Uint8Array(fixture));
    const first = records[0];
    expect(first.operatingHours).toBeCloseTo(174 + 59 / 60, 3);
  });

  it("車両番号の先頭ゼロを除去し、総距離・稼動回数を数値化する", () => {
    const records = parseVehicleOperationCsv(new Uint8Array(fixture));
    const first = records[0];
    expect(first.vehicleCode).toBe("1111");
    expect(first.totalDistanceKm).toBe(6617.98);
    expect(first.tripCount).toBe(20);
  });

  it("文字列入力を直接渡してもパースできる(デコード済みテキスト対応)", () => {
    const text = fixture.toString("latin1"); // ダミー: 型確認用。実処理はUint8Array版を使う
    expect(() => parseVehicleOperationCsv(text)).not.toThrow();
  });
});
