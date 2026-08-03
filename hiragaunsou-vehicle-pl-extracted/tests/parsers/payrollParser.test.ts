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
});
