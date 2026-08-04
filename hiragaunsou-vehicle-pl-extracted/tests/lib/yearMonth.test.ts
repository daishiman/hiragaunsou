import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentYearMonth,
  defaultImportYearMonth,
  isYearMonth,
  monthsBefore,
  periodPresets,
  recentYearMonths,
  selectableYearMonths,
} from "../../app/_lib/yearMonth";

describe("currentYearMonth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("UTC日時をJST(+9h)に変換してから年月を取り出す(日付が変わらないケース)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00Z"));
    expect(currentYearMonth()).toBe("2026-08");
  });

  it("UTC上は前月・前日でもJSTでは年月が繰り上がるケースを検出する", () => {
    // UTCでは2025-12-31だが、+9hのJSTでは2026-01-01になる境界値
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-31T16:00:00Z"));
    expect(currentYearMonth()).toBe("2026-01");
  });
});

describe("defaultImportYearMonth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("当月ではなく前月を返す", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00Z"));
    expect(defaultImportYearMonth()).toBe("2026-07");
  });

  it("1月が当月のときは前年12月を返す(年またぎ)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T00:00:00Z"));
    expect(defaultImportYearMonth()).toBe("2025-12");
  });
});

describe("isYearMonth", () => {
  it("undefinedはfalse", () => {
    expect(isYearMonth(undefined)).toBe(false);
  });

  it("YYYY-MM形式は true", () => {
    expect(isYearMonth("2026-01")).toBe(true);
    expect(isYearMonth("2026-12")).toBe(true);
  });

  it("月が00や13以上はfalse(境界値)", () => {
    expect(isYearMonth("2026-00")).toBe(false);
    expect(isYearMonth("2026-13")).toBe(false);
  });

  it("先頭0埋めが無い月はfalse", () => {
    expect(isYearMonth("2026-1")).toBe(false);
  });

  it("年月以外の文字列はfalse", () => {
    expect(isYearMonth("abc")).toBe(false);
    expect(isYearMonth("")).toBe(false);
    expect(isYearMonth("2026/01")).toBe(false);
  });
});

describe("selectableYearMonths", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("当月を含め新しい→古い順にcount件返す", () => {
    expect(selectableYearMonths(3)).toEqual(["2026-03", "2026-02", "2026-01"]);
  });

  it("年をまたいでも正しく遡る", () => {
    expect(selectableYearMonths(4)).toEqual(["2026-03", "2026-02", "2026-01", "2025-12"]);
  });

  it("count=0は空配列", () => {
    expect(selectableYearMonths(0)).toEqual([]);
  });
});

describe("monthsBefore", () => {
  it("n=0は同じ月", () => {
    expect(monthsBefore("2026-05", 0)).toBe("2026-05");
  });

  it("年をまたいで遡る", () => {
    expect(monthsBefore("2026-01", 1)).toBe("2025-12");
  });

  it("複数年分遡る(12ヶ月超)", () => {
    expect(monthsBefore("2026-06", 12)).toBe("2025-06");
  });

  it("うるう年の2月を含む期間もそのまま年月として扱う", () => {
    expect(monthsBefore("2024-03", 1)).toBe("2024-02");
  });
});

describe("periodPresets", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("前月を基準に単月・3・6・12ヶ月のプリセットを返す", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00Z"));
    // defaultImportYearMonth() は前月の 2026-07 を返す
    expect(periodPresets()).toEqual([
      { label: "単月", from: "2026-07", to: "2026-07" },
      { label: "3ヶ月", from: "2026-05", to: "2026-07" },
      { label: "6ヶ月", from: "2026-02", to: "2026-07" },
      { label: "12ヶ月", from: "2025-08", to: "2026-07" },
    ]);
  });
});

describe("recentYearMonths", () => {
  it("対象月を含まず古い→新しい順にcount件返す", () => {
    expect(recentYearMonths("2026-03", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("count=0は空配列", () => {
    expect(recentYearMonths("2026-03", 0)).toEqual([]);
  });

  it("年をまたぐ場合も正しく遡る", () => {
    expect(recentYearMonths("2026-01", 2)).toEqual(["2025-11", "2025-12"]);
  });
});
