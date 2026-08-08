import { describe, expect, it } from "vitest";
import {
  formatNumberInput,
  parseNumberInput,
  toInputText,
} from "../../app/_lib/numberInput";

/**
 * 事務所では全角で打つ人・請求書から「1,050,000円」ごと貼る人が混在する。
 * 打ち直させないための受け口なので、実際に来る形をそのまま並べて固定する。
 */
describe("parseNumberInput", () => {
  it("全角で打たれても受ける", () => {
    expect(parseNumberInput("１０５００００")).toBe(1050000);
    expect(parseNumberInput("１２．５")).toBe(12.5);
  });

  it("カンマ・空白付きで貼り付けられても受ける", () => {
    expect(parseNumberInput("1,050,000")).toBe(1050000);
    expect(parseNumberInput(" 1,050,000 ")).toBe(1050000);
    expect(parseNumberInput("１，０５０，０００")).toBe(1050000);
  });

  it("単位ごと貼り付けられても受ける", () => {
    expect(parseNumberInput("1,050,000円")).toBe(1050000);
    expect(parseNumberInput("1,858.3km")).toBe(1858.3);
    expect(parseNumberInput("7.1時間")).toBe(7.1);
    expect(parseNumberInput("120L")).toBe(120);
  });

  it("マイナスを受ける (割引・調整で実際に入る)", () => {
    expect(parseNumberInput("-1,200")).toBe(-1200);
    expect(parseNumberInput("－1200")).toBe(-1200);
  });

  it("数値として読めないものは null (推測で埋めない)", () => {
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("-")).toBeNull();
    expect(parseNumberInput("あとで")).toBeNull();
    expect(parseNumberInput("1,05a,000")).toBeNull();
    expect(parseNumberInput("1.2.3")).toBeNull();
  });
});

/**
 * 打っている最中に呼ばれる。カーソルの手前を壊すと入力が続けられなくなるので、
 * 「小数点を打った直後」「0を打った直後」を必ず残すことを固定しておく。
 */
describe("formatNumberInput", () => {
  it("整数部に3桁区切りを入れる", () => {
    expect(formatNumberInput("1050000")).toBe("1,050,000");
    expect(formatNumberInput("850")).toBe("850");
  });

  it("入力途中の小数点を消さない", () => {
    expect(formatNumberInput("1858.")).toBe("1,858.");
    expect(formatNumberInput("1858.0")).toBe("1,858.0");
    expect(formatNumberInput("1858.30")).toBe("1,858.30");
  });

  it("すでに区切られた文字列を二重に区切らない", () => {
    expect(formatNumberInput("1,050,000")).toBe("1,050,000");
  });

  it("全角のまま打たれても半角の区切りに直す", () => {
    expect(formatNumberInput("１０５００００")).toBe("1,050,000");
  });

  it("マイナスを保つ", () => {
    expect(formatNumberInput("-1200")).toBe("-1,200");
  });

  it("空文字は空文字のまま (0を勝手に入れない)", () => {
    expect(formatNumberInput("")).toBe("");
  });

  it("数字でない文字が混ざったら整形せずそのまま返す", () => {
    expect(formatNumberInput("あとで")).toBe("あとで");
  });
});

describe("toInputText", () => {
  it("確定した数値を区切り付きで入力欄に戻す", () => {
    expect(toInputText(1050000)).toBe("1,050,000");
    expect(toInputText(1858.34, 1)).toBe("1,858.3");
  });

  it("値が無いときは空欄 (0と区別する)", () => {
    expect(toInputText(null)).toBe("");
    expect(toInputText(0)).toBe("0");
  });
});
