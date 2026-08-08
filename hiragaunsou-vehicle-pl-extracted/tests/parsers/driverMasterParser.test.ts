import { describe, expect, it } from "vitest";
import Encoding from "encoding-japanese";
import {
  parseDriverMasterCsv,
  parseDriverMasterFile,
} from "../../src/infrastructure/parsers/driverMasterParser";
import {
  buildAnnualWorkbookFixture,
  buildMonthlyPlWorkbookFixture,
} from "../fixtures/monthlyPlWorkbook";

const HEADER = "社員No,氏名,車番";

describe("parseDriverMasterCsv", () => {
  it("社員No・氏名・車番を取り込む", () => {
    const { valid, errors } = parseDriverMasterCsv(`${HEADER}\n1001,山田太郎,24\n1002,鈴木一郎,300`);

    expect(errors).toEqual([]);
    expect(valid).toEqual([
      { employeeCode: "1001", driverName: "山田太郎", vehicleNo: "24" },
      { employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "300" },
    ]);
  });

  /**
   * 給与集計表の社員Noも運行実績の車番も先頭ゼロ付きで出力されることがある。
   * ここで同じ正規化をかけておかないと、突合が静かに外れて人件費が0のまま並ぶ。
   */
  it("社員Noと車番の先頭ゼロを落として、給与・運行実績と同じキーに揃える", () => {
    const { valid } = parseDriverMasterCsv(`${HEADER}\n0001,山田太郎,0024`);

    expect(valid[0]).toEqual({ employeeCode: "1", driverName: "山田太郎", vehicleNo: "24" });
  });

  it("給与集計表と同じ全角スペース入りの見出し「氏　名」も受ける", () => {
    const { valid } = parseDriverMasterCsv("社員No,氏　名,車番\n1001,山田太郎,24");

    expect(valid[0]?.driverName).toBe("山田太郎");
  });

  it("車番が空の行は未割当として取り込む(内勤・退職者を弾かない)", () => {
    const { valid, errors } = parseDriverMasterCsv(`${HEADER}\n1001,山田太郎,`);

    expect(errors).toEqual([]);
    expect(valid[0]?.vehicleNo).toBeNull();
  });

  /**
   * 社員Noは主キー。後勝ちで黙って上書きすると、どちらの車番が採用されたか
   * 誰にも分からないまま、その人の給与が別の車両に乗る。
   */
  it("社員Noの重複は後勝ちにせず、行番号を添えて弾く", () => {
    const { valid, errors } = parseDriverMasterCsv(
      `${HEADER}\n1001,山田太郎,24\n1001,山田太郎,300`,
    );

    expect(valid).toHaveLength(1);
    expect(valid[0]?.vehicleNo).toBe("24");
    expect(errors[0]).toEqual({
      rowNumber: 3,
      employeeCode: "1001",
      reason: "社員Noが2行目と重複しています(同じ社員Noを2つの車番に割り当てられません)",
    });
  });

  it("氏名が空の行はエラーにする", () => {
    const { valid, errors } = parseDriverMasterCsv(`${HEADER}\n1001,,24`);

    expect(valid).toEqual([]);
    expect(errors[0]?.reason).toBe("氏名が空です");
  });

  it("合計行・空行は読み飛ばす", () => {
    const { valid, errors } = parseDriverMasterCsv(`${HEADER}\n,合計,\n1001,山田太郎,24`);

    expect(errors).toEqual([]);
    expect(valid).toHaveLength(1);
  });

  it("必須列が欠けたCSVは、何が足りないか分かる形で失敗する", () => {
    expect(() => parseDriverMasterCsv("社員No,氏名\n1001,山田太郎")).toThrow(/運転者マスタ/);
  });
});

describe("parseDriverMasterFile (Excel)", () => {
  const HEADING = "令和8年5月車両別収支表";

  it("社内Excelの収支シートの「コード」「運転者名」「車番」から運転者マスタを取り込める", () => {
    const xlsx = buildMonthlyPlWorkbookFixture({
      heading: HEADING,
      vehicleRows: [
        { no: 24, code: "0093", driver: "浅沼　秀敏", type: "大型" },
        { no: 300, code: "1002", driver: "鈴木一郎", type: "大型" },
      ],
    });

    const { valid, errors, source } = parseDriverMasterFile(xlsx, "2026-05");

    expect(errors).toEqual([]);
    expect(valid).toEqual([
      { employeeCode: "93", driverName: "浅沼　秀敏", vehicleNo: "24" },
      { employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "300" },
    ]);
    expect(source).toMatchObject({ kind: "excel", sheetYearMonth: "2026-05" });
  });

  /** けん引の組は車番が1セルにまとまっている。運転者が乗るのは自走するトラクタ側。 */
  it("車番が「129 1113」のようにまとまっている行は、先頭のトラクタに割り当てる", () => {
    const xlsx = buildMonthlyPlWorkbookFixture({
      heading: HEADING,
      vehicleRows: [{ no: "129　　1113", code: "500", driver: "田中三郎", type: "セミトレ" }],
    });

    expect(parseDriverMasterFile(xlsx, "2026-05").valid).toEqual([
      { employeeCode: "500", driverName: "田中三郎", vehicleNo: "129" },
    ]);
  });

  it("2人乗務(コード・運転者名が同じ区切りで複数)は1人ずつの行に分ける", () => {
    const xlsx = buildMonthlyPlWorkbookFixture({
      heading: HEADING,
      vehicleRows: [{ no: 24, code: "93/94", driver: "浅沼　秀敏/佐藤　一郎", type: "大型" }],
    });

    expect(parseDriverMasterFile(xlsx, "2026-05").valid).toEqual([
      { employeeCode: "93", driverName: "浅沼　秀敏", vehicleNo: "24" },
      { employeeCode: "94", driverName: "佐藤　一郎", vehicleNo: "24" },
    ]);
  });

  it("社員Noと運転者名の人数が合わない行は、勝手に組まず理由付きで弾く", () => {
    const xlsx = buildMonthlyPlWorkbookFixture({
      heading: HEADING,
      vehicleRows: [{ no: 24, code: "93/94", driver: "浅沼　秀敏", type: "大型" }],
    });

    const { valid, errors } = parseDriverMasterFile(xlsx, "2026-05");
    expect(valid).toEqual([]);
    expect(errors[0]?.reason).toContain("数が合いません");
  });

  it("運転者名はあるのに社員Noが空欄の行は、車番と氏名を添えて指摘する", () => {
    const xlsx = buildMonthlyPlWorkbookFixture({
      heading: HEADING,
      vehicleRows: [{ no: 24, code: "", driver: "山田太郎", type: "大型" }],
    });

    const { errors } = parseDriverMasterFile(xlsx, "2026-05");
    expect(errors[0]?.reason).toContain("車番24の運転者「山田太郎」に社員Noが入っていません");
  });

  /** 傭車(88888)・諸口は自社の運転者ではないので、社員Noが無くても指摘しない。 */
  it("傭車・諸口の行は指摘せず読み飛ばす", () => {
    const xlsx = buildMonthlyPlWorkbookFixture({
      heading: HEADING,
      vehicleRows: [
        { no: 88888, code: "", driver: "傭車", type: "大型" },
        { no: 10, code: "", driver: "諸口", type: "大型" },
      ],
    });

    expect(parseDriverMasterFile(xlsx, "2026-05")).toMatchObject({ valid: [], errors: [] });
  });

  /**
   * 社員Noと車番の対応は月ごとの実績ではなく人事の状態なので、対象年月のシートが
   * 無くてもいちばん新しい月で代用する。ここで失敗させていたため、8月に既定の対象月(6月)で
   * 5月までのブックを選ぶと必ず 422 になり、画面は0名のままだった。
   */
  it("対象年月のシートが無いときは、いちばん新しい月のシートで代用して取り込む", () => {
    const xlsx = buildAnnualWorkbookFixture([
      {
        sheetName: "4月収支表",
        heading: "令和8年4月車両別収支表",
        vehicleRows: [{ no: 24, code: "93", driver: "浅沼　秀敏", type: "大型" }],
      },
      {
        sheetName: "5月収支表",
        heading: "令和8年5月車両別収支表",
        vehicleRows: [{ no: 300, code: "1002", driver: "鈴木一郎", type: "大型" }],
      },
    ]);

    const { valid, source } = parseDriverMasterFile(xlsx, "2026-06");

    expect(valid).toEqual([{ employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "300" }]);
    expect(source).toMatchObject({
      kind: "excel",
      sheetName: "5月収支表",
      sheetYearMonth: "2026-05",
      fallbackFromYearMonth: "2026-06",
    });
  });

  it("CSV(cp932)はこれまでどおり同じ入口で取り込める(拡張子ではなく中身で振り分ける)", () => {
    const csv = Uint8Array.from(
      Encoding.convert(Encoding.stringToCode(`${HEADER}\n1001,山田太郎,24`), {
        to: "SJIS",
        from: "UNICODE",
      }),
    );
    expect(parseDriverMasterFile(csv).valid).toEqual([
      { employeeCode: "1001", driverName: "山田太郎", vehicleNo: "24" },
    ]);
  });
});
