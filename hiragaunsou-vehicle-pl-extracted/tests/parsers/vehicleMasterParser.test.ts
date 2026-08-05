import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mapVehicleTypeToCostCategory,
  parseVehicleMasterCsv,
} from "../../src/infrastructure/parsers/vehicleMasterParser";
import { decodeCp932 } from "../../src/infrastructure/parsers/encoding";

const fixture = readFileSync(resolve(__dirname, "../fixtures/vehicle_master_sample.csv"));

const HEADER = "車番,車種名,所属,自賠責保険,任意保険,自動車税,自動車重量税,車両リース費,車両割賦支払費";

describe("mapVehicleTypeToCostCategory", () => {
  it("車種名の表記ゆれを吸収して原価カテゴリへ寄せる", () => {
    expect(mapVehicleTypeToCostCategory("大型ウイング")).toBe("large");
    expect(mapVehicleTypeToCostCategory("10tダンプ")).toBe("large");
    expect(mapVehicleTypeToCostCategory("増トン")).toBe("large");
    expect(mapVehicleTypeToCostCategory("セミトレ")).toBe("semiTrailer");
    expect(mapVehicleTypeToCostCategory("トレーラ")).toBe("semiTrailer");
    expect(mapVehicleTypeToCostCategory("ユニック車")).toBe("unic");
    expect(mapVehicleTypeToCostCategory("6.5tダンプ")).toBe("6.5t");
    expect(mapVehicleTypeToCostCategory("中型")).toBe("medium");
    expect(mapVehicleTypeToCostCategory("4tアルミバン")).toBe("medium");
  });

  it("全角英数字・空白の混在も同じカテゴリに解決する", () => {
    expect(mapVehicleTypeToCostCategory("６．５ｔ ウイング")).toBe("6.5t");
    expect(mapVehicleTypeToCostCategory("　大型　")).toBe("large");
  });

  it("大型セミトレーラはセミトレーラ側に寄せる(ルールの評価順)", () => {
    expect(mapVehicleTypeToCostCategory("大型セミトレーラ")).toBe("semiTrailer");
  });

  it("判定できない車種名・空文字はnullを返す(mediumへ黙って倒さない)", () => {
    expect(mapVehicleTypeToCostCategory("特装車")).toBeNull();
    expect(mapVehicleTypeToCostCategory("")).toBeNull();
  });
});

describe("parseVehicleMasterCsv", () => {
  it("cp932 CSVをパースし、車番の先頭ゼロ除去と金額のカンマ除去を行う", () => {
    const { valid } = parseVehicleMasterCsv(new Uint8Array(fixture));
    const first = valid[0];
    expect(first.vehicleNo).toBe("1111");
    expect(first.vehicleType).toBe("大型ウイング");
    expect(first.depot).toBe("本社");
    expect(first.costCategory).toBe("large");
    expect(first.insCompulsory).toBe(1530);
    expect(first.insVoluntary).toBe(12000);
    expect(first.taxAuto).toBe(50400);
    expect(first.taxWeight).toBe(10400);
    expect(first.lease).toBe(85000);
    expect(first.installment).toBe(0);
  });

  it("車番が空の行(合計行)はエラーにせず読み飛ばす", () => {
    const { valid, errors } = parseVehicleMasterCsv(new Uint8Array(fixture));
    expect(valid.map((r) => r.vehicleNo)).toEqual(["1111", "2222", "3333", "4444", "5555"]);
    expect(errors.every((e) => e.vehicleNo !== "")).toBe(true);
  });

  it("原価カテゴリを判定できない行は、行番号と理由付きでエラー行に分ける", () => {
    const { valid, errors } = parseVehicleMasterCsv(new Uint8Array(fixture));
    expect(valid.some((r) => r.vehicleNo === "6666")).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].vehicleNo).toBe("6666");
    expect(errors[0].rowNumber).toBe(8);
    expect(errors[0].reason).toContain("特装車");
  });

  it("文字列入力を直接渡してもパースできる(デコード済みテキスト対応)", () => {
    const text = decodeCp932(new Uint8Array(fixture));
    expect(() => parseVehicleMasterCsv(text)).not.toThrow();
  });

  it("列の順番が変わっても列名で解決して取り込める", () => {
    const csv = [
      "車両割賦支払費,車両リース費,自動車重量税,自動車税,任意保険,自賠責保険,所属,車種名,車番",
      "0,50000,4100,15000,7400,980,本社,中型,00007777",
    ].join("\r\n");

    const { valid, errors } = parseVehicleMasterCsv(csv);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({
      vehicleNo: "7777",
      vehicleType: "中型",
      costCategory: "medium",
      lease: 50000,
      installment: 0,
    });
  });

  it("必須列が1つ欠けていると、欠けている列名を含む例外になる", () => {
    const csv = [
      "車番,車種名,所属,自賠責保険,任意保険,自動車税,自動車重量税,車両リース費",
      "1111,中型,本社,980,7400,15000,4100,0",
    ].join("\r\n");

    expect(() => parseVehicleMasterCsv(csv)).toThrow(/車両割賦支払費/);
  });

  it("正常行とエラー行が混在しても、正常行はそのまま取り込める", () => {
    const csv = [
      HEADER,
      "1111,大型,本社,980,7400,15000,4100,0,0",
      "2222,特装車,本社,980,7400,15000,4100,0,0",
      "3333,ユニック,本社,980,7400,15000,4100,0,0",
    ].join("\r\n");

    const { valid, errors } = parseVehicleMasterCsv(csv);
    expect(valid.map((r) => r.vehicleNo)).toEqual(["1111", "3333"]);
    expect(errors.map((e) => e.rowNumber)).toEqual([3]);
  });
});
