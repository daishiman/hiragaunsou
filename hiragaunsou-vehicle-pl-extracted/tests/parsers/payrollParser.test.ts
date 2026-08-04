import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePayrollCsv } from "../../src/infrastructure/parsers/payrollParser";

const fixture = readFileSync(resolve(__dirname, "../fixtures/payroll_sample.csv"));

describe("parsePayrollCsv", () => {
  it("社員No・氏名・総支給額・社保合計を数値として取得する", () => {
    const records = parsePayrollCsv(new Uint8Array(fixture));
    expect(records.length).toBeGreaterThan(0);
    const first = records[0];
    expect(first.employeeCode).toBe("93");
    expect(first.employeeName).toContain("浅沼");
    expect(typeof first.totalPay).toBe("number");
    expect(typeof first.socialInsuranceTotal).toBe("number");
  });

  it("カンマ区切りの総支給額を正しく数値化する(重複ヘッダーは最終ブロックの値を採用)", () => {
    const records = parsePayrollCsv(new Uint8Array(fixture));
    const first = records[0];
    expect(first.totalPay).toBeGreaterThan(0);
  });

  it("社員Noが空の行は除外する", () => {
    const records = parsePayrollCsv(new Uint8Array(fixture));
    expect(records.every((r) => r.employeeCode !== "")).toBe(true);
  });

  // 実データ(2026-05)では車種別・営業所別の小計行と総合計行が混ざっており、
  // これを1名分として取り込むと社員コードがたまたま一致した車両に数千万円の給与が乗る。
  it("車種別・営業所別の小計行と総合計行を除外する", () => {
    const header = "社員No,氏　名,総支給額,社保合計";
    const csv = [
      header,
      "0093,浅沼　秀敏,\"663,820\",\"90,000\"",
      "1,[１１ｔ]35名,\"10,571,754\",\"1,746,104\"",
      "013,[津山（月給）]9名,\"2,675,750\",\"400,000\"",
      "999,[総合計]98名,\"28,042,584\",\"4,524,163\"",
    ].join("\r\n");

    const records = parsePayrollCsv(csv);
    expect(records.map((r) => r.employeeCode)).toEqual(["93"]);
    expect(records[0].totalPay).toBe(663820);
  });

  it("列の順番が変わっても列名で解決して取り込める", () => {
    const csv = [
      "総支給額,社保合計,氏　名,社員No",
      "\"663,820\",\"90,000\",浅沼　秀敏,0093",
    ].join("\r\n");

    const records = parsePayrollCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ employeeCode: "93", totalPay: 663820, socialInsuranceTotal: 90000 });
  });

  it("氏名列の表記が「氏　名」でなく「氏名」(空白なし)でも取り込める", () => {
    const csv = ["社員No,氏名,総支給額,社保合計", '0093,浅沼　秀敏,"663,820","90,000"'].join("\r\n");

    const records = parsePayrollCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ employeeCode: "93", employeeName: "浅沼　秀敏" });
  });

  it("氏名列が「氏名」表記でも、小計行(角括弧+○名)の除外は変わらず効く", () => {
    const csv = [
      "社員No,氏名,総支給額,社保合計",
      '0093,浅沼　秀敏,"663,820","90,000"',
      '999,[総合計]98名,"28,042,584","4,524,163"',
    ].join("\r\n");

    const records = parsePayrollCsv(csv);
    expect(records.map((r) => r.employeeCode)).toEqual(["93"]);
  });

  it("必須列が1つ欠けていると、欠けている列名を含む例外になる", () => {
    const csv = ["社員No,氏　名,社保合計", "0093,浅沼　秀敏,\"90,000\""].join("\r\n");

    expect(() => parsePayrollCsv(csv)).toThrow(/総支給額/);
  });
});
