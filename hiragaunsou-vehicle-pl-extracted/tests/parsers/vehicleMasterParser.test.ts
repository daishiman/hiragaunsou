import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mapVehicleTypeToCostCategory,
  parseVehicleMasterCsv,
  parseVehicleMasterFile,
} from "../../src/infrastructure/parsers/vehicleMasterParser";
import { decodeCp932 } from "../../src/infrastructure/parsers/encoding";
import { buildMonthlyPlWorkbookFixture } from "../fixtures/monthlyPlWorkbook";

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
    // 実データの表記。「3ｔU」= 3tユニック (「10ｔW」= ウイングと同じ書き方)
    expect(mapVehicleTypeToCostCategory("3ｔU")).toBe("unic");
    expect(mapVehicleTypeToCostCategory("10ｔﾕﾆｯｸ")).toBe("unic");
    expect(mapVehicleTypeToCostCategory("6.5tダンプ")).toBe("6.5t");
    expect(mapVehicleTypeToCostCategory("中型")).toBe("medium");
    // 「被けん引車」はトレーラ本体。「トレーラ」を含む文字列より先に判定される必要がある
    // (semiTrailer に倒れると、自走しない車両に走行距離連動の標準原価が付く)。
    expect(mapVehicleTypeToCostCategory("被けん引車")).toBe("trailer");
    expect(mapVehicleTypeToCostCategory("被牽引車")).toBe("trailer");
    expect(mapVehicleTypeToCostCategory("台車")).toBe("trailer");
    expect(mapVehicleTypeToCostCategory("4tアルミバン")).toBe("medium");
  });

  it("全角英数字・空白の混在も同じカテゴリに解決する", () => {
    expect(mapVehicleTypeToCostCategory("６．５ｔ ウイング")).toBe("6.5t");
    expect(mapVehicleTypeToCostCategory("　大型　")).toBe("large");
  });

  it("大型セミトレーラはセミトレーラ側に寄せる(ルールの評価順)", () => {
    expect(mapVehicleTypeToCostCategory("大型セミトレーラ")).toBe("semiTrailer");
  });

  it("実データ(★車両別収支計算用2026年5月)の車種名10種をすべて判定できる", () => {
    // 末尾1文字の車体表記(W=ウイング, U=ユニック)を取り違えないことも併せて押さえる。
    const REAL_VEHICLE_TYPES: Record<string, string> = {
      "4ｔW": "medium",
      "10ｔ平": "large",
      "10ｔW": "large",
      "3ｔU": "unic",
      "3ｔ平": "medium",
      "4ｔ平": "medium",
      "10ｔﾁｯﾌﾟ": "large",
      "８ｔ平": "large",
      セミトレ: "semiTrailer",
      被けん引車: "trailer",
    };

    for (const [vehicleType, expected] of Object.entries(REAL_VEHICLE_TYPES)) {
      expect(mapVehicleTypeToCostCategory(vehicleType), vehicleType).toBe(expected);
    }
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

describe("parseVehicleMasterFile", () => {
  /** 実データ(★車両別収支計算用)の並び: 一般車のあとにトラクタとトレーラが交互に並ぶ。 */
  const REAL_ORDER = [
    { no: 1111, type: "10ｔW", depot: "本社", insCompulsory: 2365, insVoluntary: 12580, taxAuto: 5675, taxWeight: 5834, lease: 227062, installment: 0 },
    { no: 129, type: "セミトレ", depot: "本社", insCompulsory: 2452, insVoluntary: 13460, taxAuto: 8216, taxWeight: 9966 },
    { no: 1113, type: "被けん引車", depot: "" },
    { no: 2, type: "セミトレ", depot: "本社", insCompulsory: 2452, insVoluntary: 13460, taxAuto: 8216, taxWeight: 9966 },
    { no: 1100, type: "被けん引車", depot: "" },
  ] as const;

  it("Excel(.xlsx)をそのまま渡しても、収支表シートから車両マスタを取り込める", () => {
    const xlsx = buildMonthlyPlWorkbookFixture({ vehicleRows: [...REAL_ORDER] });

    const { valid, errors } = parseVehicleMasterFile(xlsx);

    expect(errors).toHaveLength(0);
    expect(valid.map((r) => r.vehicleNo)).toEqual(["1111", "129", "1113", "2", "1100"]);
    expect(valid[0]).toMatchObject({
      vehicleType: "10ｔW",
      depot: "本社",
      costCategory: "large",
      insCompulsory: 2365,
      insVoluntary: 12580,
      taxAuto: 5675,
      taxWeight: 5834,
      lease: 227062,
      installment: 0,
    });
  });

  it("被けん引車の直前のセミトレーラをけん引先として復元する(対応表が元データに列として無いため)", () => {
    const xlsx = buildMonthlyPlWorkbookFixture({ vehicleRows: [...REAL_ORDER] });

    const { valid } = parseVehicleMasterFile(xlsx);
    const towedBy = Object.fromEntries(valid.map((r) => [r.vehicleNo, r.towedByVehicleNo]));

    expect(towedBy["1113"]).toBe("129");
    expect(towedBy["1100"]).toBe("2");
    // トラクタ・一般車には値を入れない(画面のけん引先セレクトはトレーラ行だけに出る)
    expect(towedBy["129"]).toBeUndefined();
    expect(towedBy["1111"]).toBeUndefined();
  });

  it("並びから確信が持てないトレーラは undefined のままにして、手選択に委ねる", () => {
    const xlsx = buildMonthlyPlWorkbookFixture({
      vehicleRows: [
        // 先頭がトレーラ: 直前の行が無い
        { no: 900, type: "被けん引車" },
        { no: 129, type: "セミトレ", depot: "本社" },
        { no: 1113, type: "被けん引車" },
        // 1台のトラクタに2台目が続く: 129 は既に 1113 に割り当て済み
        { no: 901, type: "被けん引車" },
        // 直前が一般車(large): トラクタではないのでけん引できない
        { no: 1111, type: "10ｔW", depot: "本社" },
        { no: 902, type: "被けん引車" },
      ],
    });

    const { valid } = parseVehicleMasterFile(xlsx);
    const towedBy = Object.fromEntries(valid.map((r) => [r.vehicleNo, r.towedByVehicleNo]));

    expect(towedBy["1113"]).toBe("129");
    expect(towedBy["900"]).toBeUndefined();
    expect(towedBy["901"]).toBeUndefined();
    expect(towedBy["902"]).toBeUndefined();
  });

  it("対象年月はシートの選択に使う(月次収支表の取込と同じ判断に委ねる)", () => {
    const xlsx = buildMonthlyPlWorkbookFixture({
      sheetName: "5月収支表",
      vehicleRows: [{ no: 1111, type: "10ｔW", depot: "本社", lease: 227062 }],
    });

    // 収支表シートが1つしかないブックは、対象年月に関わらずそのシートを使う。
    // 年度ブック(12シート)で対象年月のシートが無い場合に例外になることは
    // monthlyPlWorkbookParser 側で担保している。
    expect(parseVehicleMasterFile(xlsx, "2026-05").valid).toHaveLength(1);
    expect(parseVehicleMasterFile(xlsx, "2026-09").valid).toHaveLength(1);
  });

  it("CSVはこれまでどおり同じ入口で取り込める(拡張子ではなく中身で振り分ける)", () => {
    const { valid, errors } = parseVehicleMasterFile(new Uint8Array(fixture));

    expect(errors).toHaveLength(1);
    expect(valid[0]).toMatchObject({ vehicleNo: "1111", costCategory: "large" });
  });

  it("収支表シートではないxlsxは、CSVとして文字化けさせず原因の分かる例外にする", () => {
    const notPl = buildMonthlyPlWorkbookFixture({ omitFields: ["profit"] });

    expect(() => parseVehicleMasterFile(notPl)).toThrow(/収支表シートを検出できませんでした/);
    // ZIPの中身がエラーメッセージに漏れないこと(以前は "PK…[Content_Types].xml" が出ていた)
    expect(() => parseVehicleMasterFile(notPl)).not.toThrow(/Content_Types/);
  });
});
