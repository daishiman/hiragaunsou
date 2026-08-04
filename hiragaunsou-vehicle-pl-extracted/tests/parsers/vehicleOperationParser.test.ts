import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseVehicleOperationCsv } from "../../src/infrastructure/parsers/vehicleOperationParser";
import { decodeCp932 } from "../../src/infrastructure/parsers/encoding";

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
    const text = decodeCp932(new Uint8Array(fixture));
    expect(() => parseVehicleOperationCsv(text)).not.toThrow();
  });

  it("列の順番が変わっても列名で解決して取り込める", () => {
    const csv = [
      "燃費（km/L）,総給油量（L）,総距離,稼動時間,稼動回数,車種,所属名称,車両名称,車両番号",
      "5.5,120.0,300.5,10:00,5,中型,本社,テスト車両,00001234",
    ].join("\r\n");

    const records = parseVehicleOperationCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      vehicleCode: "1234",
      vehicleName: "テスト車両",
      depot: "本社",
      vehicleType: "中型",
      tripCount: 5,
      totalDistanceKm: 300.5,
    });
  });

  it("車両番号が空の行は取込対象から除外する(車両に紐付かない実績を混ぜない)", () => {
    const csv = [
      "車両番号,車両名称,所属名称,車種,稼動回数,稼動時間,総距離,総給油量（L）,燃費（km/L）",
      ",空番,本社,中型,1,1:00,10,5,2.0",
      "00001234,テスト車両,本社,中型,5,10:00,300.5,120.0,5.5",
    ].join("\r\n");

    const records = parseVehicleOperationCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0].vehicleCode).toBe("1234");
  });

  it("必須列が1つ欠けていると、欠けている列名を含む例外になる", () => {
    const csv = ["車両番号,車両名称,所属名称,車種,稼動回数,稼動時間,総距離,燃費（km/L）", "1,テスト,本社,中型,1,1:00,10,5"].join(
      "\r\n",
    );

    expect(() => parseVehicleOperationCsv(csv)).toThrow(/総給油量（L）/);
  });
});
