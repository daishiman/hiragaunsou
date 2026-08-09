import { describe, expect, it } from "vitest";
import {
  compareValues,
  editDistanceWithin,
  looksLikeMojibake,
  normalizeCompareKey,
  normalizeIdKey,
  normalizeYearMonth,
  parseAmountLoose,
} from "../../src/domain/rules/valueNormalization";

describe("normalizeIdKey (車番・社員コードの突き合わせ)", () => {
  it("ゼロ埋めの有無を吸収する (運行実績 00001111 と 車両マスタ 1111)", () => {
    expect(normalizeIdKey("00001111")).toBe(normalizeIdKey("1111"));
  });

  it("全角数字と半角数字を同じに扱う", () => {
    expect(normalizeIdKey("１１１１")).toBe(normalizeIdKey("1111"));
  });

  it("空白詰め (売上の 303 ) を吸収する", () => {
    expect(normalizeIdKey("303       ")).toBe("303");
    expect(normalizeIdKey("　303　")).toBe("303");
  });

  it("数字以外を含むコードの先頭ゼロは落とさない (別のコード体系を壊さない)", () => {
    expect(normalizeIdKey("0A12")).toBe("0A12");
  });

  it("違う番号は違うままにする", () => {
    expect(normalizeIdKey("1111")).not.toBe(normalizeIdKey("1112"));
  });
});

describe("normalizeCompareKey (氏名などの突き合わせ)", () => {
  it("姓名の間の空白の有無を吸収する", () => {
    expect(normalizeCompareKey("田中 一郎")).toBe(normalizeCompareKey("田中一郎"));
    expect(normalizeCompareKey("田中　一郎")).toBe(normalizeCompareKey("田中一郎"));
  });

  it("半角カナと全角カナを同じに扱う", () => {
    expect(normalizeCompareKey("ﾀﾅｶ")).toBe(normalizeCompareKey("タナカ"));
  });

  it("ハイフン類・長音の書き分けを吸収する", () => {
    expect(normalizeCompareKey("A-1")).toBe(normalizeCompareKey("A－1"));
  });
});

describe("normalizeYearMonth (年月の表記ゆれ)", () => {
  it.each([
    ["2026/5", "2026-05"],
    ["2026-05", "2026-05"],
    ["2026年5月", "2026-05"],
    ["202605", "2026-05"],
    ["令和8年5月", "2026-05"],
    ["R8.5", "2026-05"],
  ])("%s を %s に揃える", (input, expected) => {
    expect(normalizeYearMonth(input)).toBe(expected);
  });

  it("13月のようなあり得ない月は読めなかったことにする", () => {
    expect(normalizeYearMonth("2026-13")).toBeNull();
  });
});

describe("parseAmountLoose (金額の表記ゆれ)", () => {
  it.each([
    ["1,234", 1234],
    ["¥1,234", 1234],
    ["１２３４", 1234],
    ["1234円", 1234],
    ["(1,234)", -1234],
    ["▲1,234", -1234],
    ["△1,234", -1234],
    ["-1,234", -1234],
  ])("%s を %d と読む", (input, expected) => {
    expect(parseAmountLoose(input).value).toBe(expected);
  });

  it("空欄と0を区別する (入力漏れが0円の実績にならないように)", () => {
    expect(parseAmountLoose("")).toEqual({ value: null, blank: true });
    expect(parseAmountLoose("0")).toEqual({ value: 0, blank: false });
  });

  it("会計表の - は「該当なし」であって0円ではない", () => {
    expect(parseAmountLoose("-").blank).toBe(true);
  });
});

describe("looksLikeMojibake (文字化けの疑い)", () => {
  it("置換文字が出ていれば化けているとみなす", () => {
    expect(looksLikeMojibake("\uFFFD\uFFFD\uFFFD")).toBe(true);
  });

  it("Shift_JIS を Latin-1 として読んだような並びを拾う", () => {
    // "日本" (UTF-8) のバイト列を Latin-1 として読んだ形
    expect(looksLikeMojibake("\u00e6\u0097\u00a5\u00e6\u009c\u00ac")).toBe(true);
  });

  it("ふつうの日本語は化けているとみなさない", () => {
    expect(looksLikeMojibake("田中一郎")).toBe(false);
    expect(looksLikeMojibake("大型トラクタ")).toBe(false);
  });
});

describe("compareValues (自動で吸収してよい差か)", () => {
  it("書き方が違うだけなら same_after_normalize", () => {
    expect(compareValues("田中 一郎", "田中一郎", { kind: "name" })).toBe("same_after_normalize");
    expect(compareValues("00001111", "1111", { kind: "id" })).toBe("same_after_normalize");
  });

  it("1文字違いは自動同一視せず near にとどめる (田中と田仲は別人でありうる)", () => {
    expect(compareValues("田中一郎", "田仲一郎", { kind: "name" })).toBe("near");
  });

  it("まったく別の名前は different", () => {
    expect(compareValues("田中一郎", "佐藤次郎", { kind: "name" })).toBe("different");
  });

  it("空と非空は「似ている」ではなく「増えた/消えた」なので different", () => {
    expect(compareValues("", "1111", { kind: "id" })).toBe("different");
  });

  it("短い文字列では2文字違いを候補にしない", () => {
    expect(compareValues("101", "202", { kind: "id" })).toBe("different");
  });
});

describe("editDistanceWithin", () => {
  it("上限を超えたら false", () => {
    expect(editDistanceWithin("abcdef", "abcdef", 1)).toBe(true);
    expect(editDistanceWithin("abcdef", "abcdeX", 1)).toBe(true);
    expect(editDistanceWithin("abcdef", "abXdeY", 1)).toBe(false);
  });
});
