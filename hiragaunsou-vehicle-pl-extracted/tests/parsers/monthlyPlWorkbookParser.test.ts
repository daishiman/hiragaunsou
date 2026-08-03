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
});
