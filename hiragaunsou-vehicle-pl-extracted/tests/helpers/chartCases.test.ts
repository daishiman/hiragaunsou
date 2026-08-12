import { describe, expect, it } from "vitest";
import { CHART_CASES } from "../e2e/fixtures/chartCases";

describe("CHART_CASES", () => {
  it("期間の最小・中間・最大13ヶ月と、正・負・0・未取込を含む", () => {
    expect(CHART_CASES).toHaveLength(13);
    expect(CHART_CASES.map((item) => item.props.points.length)).toEqual([
      1, 1, 1, 3, 3, 3, 6, 13, 13, 13, 13, 13, 13,
    ]);

    const values = CHART_CASES.flatMap((item) =>
      item.props.points.map((point) => point.value),
    );
    expect(values.some((value) => value > 0)).toBe(true);
    expect(values.some((value) => value < 0)).toBe(true);
    expect(values).toContain(0);
    expect(
      CHART_CASES.flatMap((item) => item.props.points).some(
        (point) => point.isEmpty && point.value === 0,
      ),
    ).toBe(true);
  });

  it("代表境界の金額と、12月から1月への年跨ぎラベルを正確に作る", () => {
    const billionCase = CHART_CASES.find((item) =>
      item.name.includes("値ラベルの文字数が最大"),
    );
    expect(Math.max(...billionCase!.props.points.map((point) => point.value))).toBe(
      1_234_000_000,
    );
    expect(billionCase!.expectedLabels).toContain("12.34億円");

    const crossingCase = CHART_CASES.find((item) =>
      item.name.includes("1月をまたいで"),
    );
    expect(crossingCase!.props.points.map((point) => point.label)).toEqual([
      "2025/10月",
      "11月",
      "12月",
      "2026/1月",
      "2月",
      "3月",
      "4月",
      "5月",
      "6月",
      "7月",
      "8月",
      "9月",
      "10月",
    ]);
  });

  it("前年値とnullを、グラフ入力のreferenceへそのまま反映する", () => {
    const withReferences = CHART_CASES.find((item) =>
      item.name.includes("年間集計と同じ形"),
    );
    expect(withReferences!.props.points[0]!.reference).toBe(5_000_000);

    const withoutReferences = CHART_CASES[0]!;
    expect(withoutReferences.props.points[0]!.reference).toBeNull();

    const emptyPoint = CHART_CASES.find((item) =>
      item.name.includes("未取込の月"),
    )!.props.points.find((point) => point.isEmpty);
    expect(emptyPoint).toMatchObject({ value: 0, isEmpty: true, reference: null });
  });
});
