import { describe, expect, it } from "vitest";
import { parseSumExpression } from "../../app/(app)/manual-entry/ManualEntryStepper";

/**
 * 業務フロー STEP6: 高速協の請求書には割引額の合計が載っていないため、
 * 個別の割引額をその場で足し合わせる。電卓に持ち替えずに済ませることが目的。
 */
describe("parseSumExpression", () => {
  it("単一の数値をそのまま返す", () => {
    expect(parseSumExpression("1200")).toBe(1200);
  });

  it("足し算式を合計する", () => {
    expect(parseSumExpression("1200+340+560")).toBe(2100);
  });

  it("カンマ・空白付きで貼り付けても受け付ける", () => {
    expect(parseSumExpression(" 1,200 + 340 ")).toBe(1540);
  });

  it("全角の数字と＋を受け付ける(日本語入力のまま打っても通る)", () => {
    expect(parseSumExpression("１２００＋３４０")).toBe(1540);
  });

  it("小数を含む金額も足せる", () => {
    expect(parseSumExpression("100.5+99.5")).toBe(200);
  });

  it("空文字は未入力(null)として扱う — 0円と区別する", () => {
    expect(parseSumExpression("")).toBeNull();
    expect(parseSumExpression("   ")).toBeNull();
  });

  it("0 は0円として扱う(未入力ではない)", () => {
    expect(parseSumExpression("0")).toBe(0);
  });

  it("金額の書き方の揺れは受ける(請求書からそのまま写せる)", () => {
    expect(parseSumExpression("1200円")).toBe(1200);
    expect(parseSumExpression("¥1,200")).toBe(1200);
  });

  it("数字と + 以外が混ざったら null を返し、確定させない", () => {
    expect(parseSumExpression("1200-300")).toBeNull();
    expect(parseSumExpression("あとで")).toBeNull();
    expect(parseSumExpression("1200円分")).toBeNull();
  });

  it("末尾の + は入力途中とみなして無視する", () => {
    expect(parseSumExpression("1200+")).toBe(1200);
  });
});
