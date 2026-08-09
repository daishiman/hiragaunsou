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

  it("長さが違いすぎるものは、中身を見るまでもなく false", () => {
    expect(editDistanceWithin("田中", "田中一郎太郎", 2)).toBe(false);
  });
});

/*
  以下は「読めなかった」「値が無い」といった端のケース。
  ここを取りこぼすと、読めなかったものが 0 や空文字として静かに通り、
  取込の差分が嘘になる。
*/
describe("値が無い・読めないときの扱い", () => {
  it("null や undefined は空のキーになる (別物として扱わない)", () => {
    expect(normalizeIdKey(null)).toBe("");
    expect(normalizeIdKey(undefined)).toBe("");
    expect(normalizeCompareKey(null)).toBe("");
    expect(normalizeCompareKey(undefined)).toBe("");
  });

  it("年月が無い・空・読めない形は null", () => {
    expect(normalizeYearMonth(null)).toBeNull();
    expect(normalizeYearMonth(undefined)).toBeNull();
    expect(normalizeYearMonth("   ")).toBeNull();
    expect(normalizeYearMonth("来月")).toBeNull();
    expect(normalizeYearMonth("2026-00")).toBeNull();
  });

  it("西暦としてあり得ない年は読めなかったことにする", () => {
    expect(normalizeYearMonth("1800年5月")).toBeNull();
    expect(normalizeYearMonth("3100/5")).toBeNull();
  });

  it("数値がそのまま来たときはそのまま金額として読む", () => {
    expect(parseAmountLoose(1234)).toEqual({ value: 1234, blank: false });
    expect(parseAmountLoose(Number.NaN)).toEqual({ value: null, blank: false });
  });

  it("金額が無い・記号だけのときは空欄として返す", () => {
    expect(parseAmountLoose(null)).toEqual({ value: null, blank: true });
    expect(parseAmountLoose(undefined)).toEqual({ value: null, blank: true });
    expect(parseAmountLoose("   ")).toEqual({ value: null, blank: true });
    // 記号を外すと何も残らないものは「入っていない」扱い
    expect(parseAmountLoose("¥")).toEqual({ value: null, blank: true });
    expect(parseAmountLoose("()")).toEqual({ value: null, blank: true });
  });

  it("金額として読めない文字は、空欄ではなく読めなかったこととして返す", () => {
    expect(parseAmountLoose("約10万")).toEqual({ value: null, blank: false });
  });

  it("小数の金額も読む(単価は小数で来ることがある)", () => {
    expect(parseAmountLoose("120.5").value).toBe(120.5);
    expect(parseAmountLoose("(120.5)").value).toBe(-120.5);
  });

  it("文字化けの判定は、値が無ければ false", () => {
    expect(looksLikeMojibake(null)).toBe(false);
    expect(looksLikeMojibake(undefined)).toBe(false);
    expect(looksLikeMojibake("")).toBe(false);
    // 記号が1つ混ざるだけの外国語表記は化けているとみなさない
    expect(looksLikeMojibake("Café 田中運送")).toBe(false);
  });

  it("どちらも空なら same (どちらも未入力を差分にしない)", () => {
    expect(compareValues(null, undefined)).toBe("same");
    expect(compareValues("", null, { kind: "id" })).toBe("same");
  });

  it("種類を指定しなければ、ふつうの文字列として突き合わせる", () => {
    expect(compareValues("大型 トラクタ", "大型トラクタ")).toBe("same_after_normalize");
    expect(compareValues("大型トラクタ", "セミトレーラ")).toBe("different");
    // 1文字違いは自動で同じにせず、人に見せる側に倒す
    expect(compareValues("大型", "小型")).toBe("near");
  });
});
