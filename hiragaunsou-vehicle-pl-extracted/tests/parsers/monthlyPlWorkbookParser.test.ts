import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMonthlyPlWorkbook } from "../../src/infrastructure/parsers/monthlyPlWorkbookParser";
import { buildMonthlyPlWorkbookFixture } from "../fixtures/monthlyPlWorkbook";

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

  it("収支表がないExcelは、誤ったデータとして明示的に拒否する", () => {
    const emptyWorkbook = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(() => parseMonthlyPlWorkbook(emptyWorkbook)).toThrow("xlsx形式");
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
});
