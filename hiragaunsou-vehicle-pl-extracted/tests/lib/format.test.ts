import { describe, expect, it } from "vitest";
import { chartMonthLabel, kmPriceLabel, man, num, pct, yen, yearMonthLabel } from "../../app/_lib/format";

/**
 * ダッシュボード推移グラフの目盛りラベル。年をまたぐ期間で「9月」が重複して
 * 見分けがつかなくなる問題への対応 (先頭点と年替わりの1月だけ年を添える)。
 */
describe("chartMonthLabel", () => {
  it("先頭の点は常に年を添える", () => {
    expect(chartMonthLabel("2025-09", 0)).toBe("2025/9月");
  });

  it("先頭以外・1月以外は月だけを返す", () => {
    expect(chartMonthLabel("2026-03", 3)).toBe("3月");
  });

  it("先頭でなくても1月は年を添える (年替わりの目印)", () => {
    expect(chartMonthLabel("2026-01", 5)).toBe("2026/1月");
  });
});

describe("yen", () => {
  it("null は—", () => {
    expect(yen(null)).toBe("—");
  });

  it("undefined は—", () => {
    expect(yen(undefined)).toBe("—");
  });

  it("NaN/Infinity は—", () => {
    expect(yen(NaN)).toBe("—");
    expect(yen(Infinity)).toBe("—");
    expect(yen(-Infinity)).toBe("—");
  });

  it("0円はそのまま0", () => {
    expect(yen(0)).toBe("0");
  });

  it("3桁カンマ区切りになる", () => {
    expect(yen(1234567)).toBe("1,234,567");
  });

  it("負値は会計表記の▲を付け、絶対値をカンマ区切りにする", () => {
    expect(yen(-1234567)).toBe("▲1,234,567");
  });

  it("小数は四捨五入される", () => {
    expect(yen(1234.6)).toBe("1,235");
    expect(yen(1234.4)).toBe("1,234");
  });

  it("負の小数も四捨五入してから▲を付ける", () => {
    expect(yen(-1234.6)).toBe("▲1,235");
  });
});

describe("man", () => {
  it("null/undefinedは—", () => {
    expect(man(null)).toBe("—");
    expect(man(undefined)).toBe("—");
  });

  it("0円は0万円", () => {
    expect(man(0)).toBe("0万円");
  });

  it("1万円未満は四捨五入で0万円になる", () => {
    expect(man(4999)).toBe("0万円");
  });

  it("万円単位に丸める", () => {
    expect(man(12345)).toBe("1万円");
  });

  it("負値は▲を付ける (億円未満)", () => {
    expect(man(-12345)).toBe("▲1万円");
  });

  it("1億円ちょうどは億円表記(小数2桁)に切り替わる", () => {
    expect(man(100_000_000)).toBe("1.00億円");
  });

  it("1億円未満ぎりぎりは万円表記のまま", () => {
    expect(man(99_999_999)).toBe("10,000万円");
  });

  it("億円単位でも負値には▲を付ける", () => {
    expect(man(-150_000_000)).toBe("▲1.50億円");
  });

  it("億円は小数第2位までのまま切り捨てず表示する", () => {
    expect(man(123_456_789)).toBe("1.23億円");
  });
});

describe("pct", () => {
  it("null/undefinedは—", () => {
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
  });

  it("0は0.0%", () => {
    expect(pct(0)).toBe("0.0%");
  });

  it("小数第1位までがデフォルト", () => {
    expect(pct(0.1342)).toBe("13.4%");
  });

  it("digits指定で桁数を変えられる", () => {
    expect(pct(0.1342, 2)).toBe("13.42%");
    expect(pct(0.1342, 0)).toBe("13%");
  });

  it("負値は符号付きのまま(▲は付けない)", () => {
    expect(pct(-0.05)).toBe("-5.0%");
  });

  it("NaN/Infiniteは—", () => {
    expect(pct(NaN)).toBe("—");
    expect(pct(Infinity)).toBe("—");
  });
});

describe("num", () => {
  it("null/undefinedは—", () => {
    expect(num(null)).toBe("—");
    expect(num(undefined)).toBe("—");
  });

  it("デフォルトは整数・3桁カンマ区切り", () => {
    expect(num(1234567)).toBe("1,234,567");
  });

  it("digits指定で小数桁を固定できる", () => {
    expect(num(1234.567, 2)).toBe("1,234.57");
  });

  it("0はそのまま0", () => {
    expect(num(0)).toBe("0");
  });

  it("負値は▲を付けずマイナス記号のまま", () => {
    expect(num(-1234)).toBe("-1,234");
  });

  it("NaN/Infiniteは—", () => {
    expect(num(NaN)).toBe("—");
    expect(num(Infinity)).toBe("—");
  });
});

describe("kmPriceLabel", () => {
  it("null/undefinedは—", () => {
    expect(kmPriceLabel(null)).toBe("—");
    expect(kmPriceLabel(undefined)).toBe("—");
  });

  it("小数第1位までの円/kmラベルになる", () => {
    expect(kmPriceLabel(12.34)).toBe("12.3円");
  });

  it("0は0.0円", () => {
    expect(kmPriceLabel(0)).toBe("0.0円");
  });

  it("負値はマイナス記号のまま(▲は付けない)", () => {
    expect(kmPriceLabel(-5)).toBe("-5.0円");
  });

  it("NaN/Infiniteは—", () => {
    expect(kmPriceLabel(NaN)).toBe("—");
    expect(kmPriceLabel(Infinity)).toBe("—");
  });
});

describe("yearMonthLabel", () => {
  it("2026-05 は 2026年5月", () => {
    expect(yearMonthLabel("2026-05")).toBe("2026年5月");
  });

  it("先頭0埋めの月も数値として表示する(2026-01 は 2026年1月)", () => {
    expect(yearMonthLabel("2026-01")).toBe("2026年1月");
  });

  it("12月も正しく表示する", () => {
    expect(yearMonthLabel("2026-12")).toBe("2026年12月");
  });
});
