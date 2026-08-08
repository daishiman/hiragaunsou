import { describe, expect, it } from "vitest";
import Encoding from "encoding-japanese";
import { findMissingColumns } from "../../src/infrastructure/parsers/requiredHeaders";
import { computeContentHash } from "../../src/infrastructure/parsers/contentHash";

/** 社内のCSVはWindowsのExcelから書き出したcp932。実データと同じ形で渡す。 */
function toBuffer(text: string): ArrayBuffer {
  const bytes = Uint8Array.from(
    Encoding.convert(Encoding.stringToCode(text), { to: "SJIS", from: "UNICODE" }),
  );
  return bytes.buffer as ArrayBuffer;
}

describe("findMissingColumns", () => {
  it("必要な列が揃っていれば何も返さない", () => {
    const csv = "社員No,氏　名,車番\n1001,平賀 太郎,129\n";
    expect(findMissingColumns("driver_master", toBuffer(csv))).toEqual([]);
  });

  it("足りない列を画面にそのまま出せる名前で返す", () => {
    const csv = "社員No,氏　名\n1001,平賀 太郎\n";
    expect(findMissingColumns("driver_master", toBuffer(csv))).toEqual(["車番"]);
  });

  it("別名が許される列は「AまたはB」の形で返す", () => {
    const csv = "社員No,車番\n1001,129\n";
    expect(findMissingColumns("driver_master", toBuffer(csv))).toEqual(["氏　名または氏名"]);
  });

  it("別名の方(氏名)で書かれていても足りているとみなす", () => {
    const csv = "社員No,氏名,車番\n1001,平賀 太郎,129\n";
    expect(findMissingColumns("driver_master", toBuffer(csv))).toEqual([]);
  });

  it("Excelは列の位置が固定でないのでここでは判定しない(取込本体に委ねる)", () => {
    // ZIP署名(PK)で始まるものを xlsx とみなしている
    const xlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).buffer;
    expect(findMissingColumns("driver_master", xlsx)).toEqual([]);
  });

  it("必須列を定めていない取込口では何も返さない", () => {
    expect(findMissingColumns("monthly_pl_workbook", toBuffer("なにか,の,列\n"))).toEqual([]);
  });

  it("中身が空でも例外にしない", () => {
    expect(findMissingColumns("driver_master", toBuffer(""))).toEqual([]);
  });
});

describe("computeContentHash", () => {
  it("中身が同じなら同じ値になる(ファイル名は関係しない)", async () => {
    const a = await computeContentHash(toBuffer("社員No,氏名,車番\n1001,平賀 太郎,129\n"));
    const b = await computeContentHash(toBuffer("社員No,氏名,車番\n1001,平賀 太郎,129\n"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("1文字でも違えば別の値になる", async () => {
    const a = await computeContentHash(toBuffer("1001,平賀 太郎,129"));
    const b = await computeContentHash(toBuffer("1001,平賀 太郎,130"));
    expect(a).not.toBe(b);
  });
});
