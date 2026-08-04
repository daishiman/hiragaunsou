import { describe, expect, it } from "vitest";
import { parseDurationToHours } from "../../src/infrastructure/parsers/timeUtils";

describe("parseDurationToHours", () => {
  it("H:MM 形式 (稼動時間) を10進時間へ変換する", () => {
    expect(parseDurationToHours("174:59")).toBeCloseTo(174 + 59 / 60, 4);
  });

  it("H:MM:SS 形式 (実車時間等) を10進時間へ変換する", () => {
    expect(parseDurationToHours("158:08:58")).toBeCloseTo(
      158 + 8 / 60 + 58 / 3600,
      4,
    );
  });

  it("0:00:00 は 0 になる", () => {
    expect(parseDurationToHours("0:00:00")).toBe(0);
  });

  it("空文字・null・undefinedは0を返す", () => {
    expect(parseDurationToHours("")).toBe(0);
    expect(parseDurationToHours(null)).toBe(0);
    expect(parseDurationToHours(undefined)).toBe(0);
  });

  it("コロンなしの数値文字列はそのまま数値化する", () => {
    expect(parseDurationToHours("12.5")).toBe(12.5);
  });

  it("不正な文字列は0を返す(例外を投げない)", () => {
    expect(parseDurationToHours("abc:def")).toBe(0);
  });

  it("コロンが3つ以上(H:MM:SSより多い区切り)の想定外形式は0を返す", () => {
    // 各要素は数値として妥当でも、コロン区切りが4要素になる時間表記は想定していない。
    // 「コロンなし」フォールバックにも一致しない(文字列全体としては数値化できない)ため0で安全側に倒す。
    expect(parseDurationToHours("1:02:03:04")).toBe(0);
  });
});
