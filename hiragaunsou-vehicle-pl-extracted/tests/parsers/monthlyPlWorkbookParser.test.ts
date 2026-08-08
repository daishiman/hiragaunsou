import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { parseMonthlyPlWorkbook } from "../../src/infrastructure/parsers/monthlyPlWorkbookParser";
import { buildMonthlyPlWorkbookFixture } from "../fixtures/monthlyPlWorkbook";
import { VEHICLE_PL_FIELDS } from "../../src/domain/entities/VehiclePl";

describe("parseMonthlyPlWorkbook", () => {
  it("ファイル名やシート名に依存せず、51列の見出しから完成済み収支表を読む", () => {
    const result = parseMonthlyPlWorkbook(buildMonthlyPlWorkbookFixture());

    expect(result.sheetName).toBe("5月収支表");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      no: "10",
      type: "大型",
      depot: "本社",
      reg: "2021-03",
      driver: "諸口",
      sales: 500000,
      profit: 80000,
      margin: 0.16,
    });
  });

  it("書式だけの空セルがあっても、隣の列の値を吸い込まず本来の列に入る", () => {
    // Excelは未入力セルを `<c r="AB4" s="18"/>` の自己終了タグで保存する。
    // 実データの収支表では「メンテ(委託)」「車両リース費」がこの形で、
    // 閉じタグ必須の正規表現だと隣のセル(※修繕費計・車両割賦支払費)の値を
    // 空セル側が飲み込み、本来の列が0に化けていた。
    const result = parseMonthlyPlWorkbook(
      buildMonthlyPlWorkbookFixture({ emptyFields: ["mainte", "lease"] }),
    );

    expect(result.rows[0]).toMatchObject({
      no: "10",
      mainte: 0,
      repairTotal: 33000, // 空セルの右隣。0に潰れてはいけない
      lease: 0,
      installment: 154498, // 空セルの右隣。0に潰れてはいけない
    });
  });

  it("空セルが連続しても、その先の列がまるごと欠落しない", () => {
    // 実データの車番17は「コード」「運転者名」が2連続の空セルで、
    // その右の「運行回数」がパース結果から消えていた。
    const result = parseMonthlyPlWorkbook(
      buildMonthlyPlWorkbookFixture({ emptyFields: ["code", "driver"] }),
    );

    expect(result.rows[0]).toMatchObject({ no: "10", code: null, driver: null, trips: 12 });
  });

  it("収支表がないExcelは、誤ったデータとして明示的に拒否する", () => {
    const emptyWorkbook = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(() => parseMonthlyPlWorkbook(emptyWorkbook)).toThrow("xlsx形式");
  });

  it("51列の並び順が変わっていても、列名で解決して取り込める", () => {
    // 末尾の "no" を先頭に戻す以外は完全に逆順(位置ではなく名前で解決できることの検証)。
    const reversed = [...VEHICLE_PL_FIELDS].reverse();
    const fieldOrder = ["no" as const, ...reversed.filter((f) => f !== "no")];
    const result = parseMonthlyPlWorkbook(buildMonthlyPlWorkbookFixture({ fieldOrder }));

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      no: "10",
      type: "大型",
      depot: "本社",
      driver: "諸口",
      sales: 500000,
      profit: 80000,
      margin: 0.16,
    });
  });

  it("想定する列名が1つ見つからない場合は、欠けている列名を含む例外になる", () => {
    expect(() => parseMonthlyPlWorkbook(buildMonthlyPlWorkbookFixture({ omitFields: ["repair"] }))).toThrow(
      "修理費",
    );
  });

  it("「車番」列が丸ごと無いシートは、収支表の見出し自体を検出できず専用のメッセージで拒否する", () => {
    // resolveColumns の「見つからない列」エラーとは異なり、そもそも収支表シートの当たりが
    // 付けられない(「車番」「損益」が両方揃った行が無い)ケース。原因を取り違えないよう文言を分けている。
    expect(() => parseMonthlyPlWorkbook(buildMonthlyPlWorkbookFixture({ omitFields: ["no"] }))).toThrow(
      "51列の収支表シートを検出できませんでした",
    );
  });

  it("同じ見出しテキストの列が複数あると、一意に決められない列名を含む例外になる", () => {
    // 「運送収入」列の見出しを、実在の「運賃」列と同じテキストに差し替えて重複させる。
    const workbook = buildMonthlyPlWorkbookFixture({ headerOverrides: { sales: "運賃" } });
    expect(() => parseMonthlyPlWorkbook(workbook)).toThrow(/同名の列が複数あり判別できない列/);
  });

  it("車両行の下に「合計」等の集計行が無いシートでも、全行を車両行として取り込む", () => {
    const result = parseMonthlyPlWorkbook(buildMonthlyPlWorkbookFixture({ omitAggregateRow: true }));
    expect(result.rows.map((row) => row.no)).toEqual(["10", "88888"]);
  });

  // 共有元データはGit管理しないため、CIでは自動的にskipするローカル受入検証。
  const sharedWorkbook = resolve(process.cwd(), "data/★車両別収支計算用2026年5月.xlsx");
  const sharedIt = existsSync(sharedWorkbook) ? it : it.skip;
  sharedIt("共有された2026年5月の実ブックから車両別収支表を抽出できる", () => {
    const result = parseMonthlyPlWorkbook(readFileSync(sharedWorkbook));
    expect(result.sheetName).toBe("5月収支表");
    expect(result.rows.length).toBeGreaterThan(100);
    expect(result.rows.some((row) => row.no === "1")).toBe(true);
  });

  /**
   * 行数と車番だけを見るテストでは、列の中身が隣とすり替わっていても素通りしてしまう。
   * (実際、空セルの自己終了タグを読み飛ばして「修繕費計」が0になり、その額が「メンテ費」に
   * 化けていたが、それまでの受入テストは全部通っていた)
   * 収支表は内訳と小計が式で結ばれているため、取り込んだ値そのものでその式を検算すれば、
   * 列がずれた瞬間に破綻する。ここが値の破損に対する最後の網になる。
   */
  sharedIt("実ブックの全車両で、内訳と小計の関係が崩れていない", () => {
    const { rows } = parseMonthlyPlWorkbook(readFileSync(sharedWorkbook));
    const broken: string[] = [];

    for (const row of rows) {
      const check = (label: string, actual: number, expected: number) => {
        // Excelの保存値は小数を含む(燃料費等)ため、円未満の丸め差は許容する。
        if (Math.abs(actual - expected) > 1) {
          broken.push(`車番${row.no} ${label}: ${actual} ≠ ${expected}`);
        }
      };
      check("運送収入", row.sales, row.fare + row.fee);
      check("運行費計", row.tollNet, row.toll - row.tollDisc);
      check("燃料費計", row.fuelTotal, row.fuelIn + row.fuelOut + row.adblue);
      check("修繕費計", row.repairTotal, row.repair + row.tire + row.equip + row.mainte);
      check("人件費計", row.laborTotal, row.salary + row.bonus + row.welfare);
      check("保険料計", row.insTotal, row.insCompulsory + row.insVoluntary);
      check("賦課税計", row.taxTotal, row.taxAuto + row.taxWeight);
      check("運送費計", row.transportTotal, row.lease + row.installment);
      check("固定費", row.fixed, row.insTotal + row.taxTotal + row.transportTotal);
      check("経費計", row.expense, row.fixed + row.variable);
      check("損益", row.profit, row.sales - row.expense);
    }

    // 車番1100(被けん引車)は元ブック側で運賃73,620が入ったまま「運送収入」の式が入っておらず、
    // その売上が収支のどこにも乗っていない。取込側で埋めると元帳票と数字が変わってしまうため、
    // パーサは元ブックのとおり読む。ここに列挙が増えたら元データ側の記入漏れを疑う。
    expect(broken).toEqual(["車番1100 運送収入: 0 ≠ 73620"]);
  });

  const annualWorkbook = resolve(process.cwd(), "data/運送収支表 2025-2026 5月更新.xlsx");
  const annualIt = existsSync(annualWorkbook) ? it : it.skip;
  annualIt("共有された年間ブックからも、ファイル名に依存せず月次収支表を抽出できる", () => {
    const result = parseMonthlyPlWorkbook(readFileSync(annualWorkbook), "2026-05");
    expect(result.sheetName).toBe("5月収支表");
    expect(result.rows.length).toBeGreaterThan(90);
    expect(result.rows.some((row) => row.no === "1")).toBe(true);
  });

  /**
   * 年度ブックは2025-06〜2026-05の12シートを持つ。「8月収支表」は令和7年(2025年)8月であり、
   * 2026-08ではない。シート名の「8月」だけで照合していたため、指定と1年ずれた実績を
   * 黙って取り込んでいた。判別できない年月は取り込まずに失敗させる。
   */
  annualIt("対象年月のシートが無いときは、別の月で代用せず明示的に失敗する", () => {
    expect(() => parseMonthlyPlWorkbook(readFileSync(annualWorkbook), "2026-08")).toThrow(
      "対象年月 2026-08 のシートがありません",
    );
  });

  annualIt("シート名ではなく帳票見出しの和暦から年月を判定する", () => {
    const result = parseMonthlyPlWorkbook(readFileSync(annualWorkbook), "2025-08");
    expect(result.sheetName).toBe("8月収支表");
    expect(result.sheetYearMonth).toBe("2025-08");
  });

  /**
   * 収支表シートは車両行のあとに「合計」「平均」、空行を挟んで「【保有車両数】」と
   * 車種別台数のブロックが続く。ここで打ち切らないと集計行が車両として取り込まれ、
   * 車種名の列に台数が入る(例: 車番「10tW」/ 車種名「55」)など列全体が崩れる。
   */
  annualIt("車両行の下にある合計・平均・保有車両数のブロックを取り込まない", () => {
    const result = parseMonthlyPlWorkbook(readFileSync(annualWorkbook), "2025-08");
    const vehicleNumbers = result.rows.map((row) => row.no);

    expect(vehicleNumbers).not.toContain("合計");
    expect(vehicleNumbers).not.toContain("平均");
    expect(vehicleNumbers).not.toContain("【保有車両数】");
    for (const vehicleTypeLabel of ["10tW", "10t平", "3tU", "3t平", "4tW", "8t平", "ヘッド", "台車"]) {
      expect(vehicleNumbers).not.toContain(vehicleTypeLabel);
    }
    // 最後の車両はセミトレの「82/113」。以降はすべて集計ブロック。
    expect(vehicleNumbers.at(-1)).toBe("82/113");
  });

  it("workbook.xmlやその関係定義が読み取れないzipは、ブック構成不明の専用メッセージで拒否する", () => {
    // xl/worksheets/sheet1.xml だけを含み、xl/workbook.xml と xl/_rels/workbook.xml.rels を欠いた
    // 不完全なzip(壊れた・非対応のxlsx)を再現する。
    const brokenWorkbook = zipSync({
      "xl/worksheets/sheet1.xml": strToU8(
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
      ),
    });
    expect(() => parseMonthlyPlWorkbook(brokenWorkbook)).toThrow("Excelブックの構成を読み取れませんでした");
  });

  it("和暦見出しが無くシート名も対象月と一致しないが、収支表シートが1つしか無ければその1件を採用する", () => {
    // 和暦見出し(令和N年M月)を書かないため sheetYearMonth は null になり、シート名も
    // 「7月収支表」ではないため名前でも一致しない。候補が1シートだけなら、それを唯一の解として採用する。
    const workbook = buildMonthlyPlWorkbookFixture({ sheetName: "収支表" });
    const result = parseMonthlyPlWorkbook(workbook, "2026-07");
    expect(result.sheetName).toBe("収支表");
    expect(result.rows.map((row) => row.no)).toEqual(["10", "88888"]);
  });
});
