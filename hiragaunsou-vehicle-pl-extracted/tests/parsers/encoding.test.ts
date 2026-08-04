import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeCp932 } from "../../src/infrastructure/parsers/encoding";

describe("decodeCp932", () => {
  it("cp932でエンコードされた実データCSVを正しくUTF-8文字列へデコードする", () => {
    const buf = readFileSync(
      resolve(__dirname, "../fixtures/vehicle_operation_sample.csv"),
    );
    const text = decodeCp932(new Uint8Array(buf));
    expect(text).toContain("車両番号");
    expect(text).toContain("稼動時間");
  });

  it("日本語の車種・所属名も正しく復元する", () => {
    const buf = readFileSync(resolve(__dirname, "../fixtures/payroll_sample.csv"));
    const text = decodeCp932(new Uint8Array(buf));
    expect(text).toContain("社員No");
  });
});
