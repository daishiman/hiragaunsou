/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendBars, type TrendPoint } from "../../../app/_components/charts/TrendBars";
import { AXIS_BAND_TOP } from "../../../app/_components/charts/trendBarsLayout";

describe("TrendBars", () => {
  it("pointsが空のときは何も描画しない", () => {
    const { container } = render(<TrendBars points={[]} title="月次売上" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("titleを元にaria-labelを組み立てる", () => {
    const points: TrendPoint[] = [
      { label: "4月", value: 100000 },
      { label: "5月", value: 120000 },
    ];
    render(<TrendBars points={points} title="月次売上" />);
    expect(screen.getByRole("img", { name: "月次売上の月次推移" })).toBeInTheDocument();
  });

  it("referenceLabelが無ければ前年の凡例・破線は描画しない", () => {
    const points: TrendPoint[] = [
      { label: "4月", value: 100000, reference: 90000 },
      { label: "5月", value: 120000, reference: 95000 },
    ];
    const { container } = render(<TrendBars points={points} title="月次売上" />);
    expect(container.querySelector("polyline")).not.toBeInTheDocument();
    expect(screen.queryByText("当期")).not.toBeInTheDocument();
  });

  it("referenceLabelがあり参照値も揃っていれば破線の参照線と凡例を描画する", () => {
    const points: TrendPoint[] = [
      { label: "4月", value: 100000, reference: 90000 },
      { label: "5月", value: 120000, reference: 95000 },
    ];
    const { container } = render(
      <TrendBars points={points} title="月次売上" referenceLabel="前年" />,
    );
    expect(container.querySelector("polyline")).toBeInTheDocument();
    expect(screen.getByText("当期")).toBeInTheDocument();
    expect(screen.getByText("前年")).toBeInTheDocument();
  });

  it("signed=falseのときは赤字の月の凡例を出さない", () => {
    const points: TrendPoint[] = [
      { label: "4月", value: -50000, reference: 10000 },
      { label: "5月", value: 20000, reference: 15000 },
    ];
    render(<TrendBars points={points} title="損益" referenceLabel="前年" signed={false} />);
    expect(screen.queryByText("赤字の月")).not.toBeInTheDocument();
  });

  it("signed=trueで負値があるときは赤字の月の凡例と危険色の棒を出す", () => {
    const points: TrendPoint[] = [
      { label: "4月", value: -50000, reference: 10000 },
      { label: "5月", value: 20000, reference: 15000 },
    ];
    const { container } = render(
      <TrendBars points={points} title="損益" referenceLabel="前年" signed />,
    );
    expect(screen.getByText("赤字の月")).toBeInTheDocument();
    const dangerBars = container.querySelectorAll('rect[fill="var(--danger)"]');
    expect(dangerBars.length).toBe(1);
  });

  it("isEmptyの月は破線の枠のみで実績バーは描かない", () => {
    const points: TrendPoint[] = [
      { label: "4月", value: 0, isEmpty: true },
      { label: "5月", value: 30000 },
    ];
    const { container } = render(<TrendBars points={points} title="月次売上" />);
    const dashedRect = container.querySelector('rect[stroke-dasharray="2 2"]');
    expect(dashedRect).toBeInTheDocument();
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain("4月: 未取込");
  });

  // 横軸の月ラベルの帯 (AXIS_BAND_TOP) より下に値ラベルが入ると
  // 「▲883万円」と「7月」が重なって読めなくなる。
  // 帯の位置は trendBarsLayout.ts が決めるので、ここに数字を写し取らない
  // (写すと、レイアウトを直したときにテストだけが古い前提で緑になる)。
  const valueLabelY = (container: HTMLElement, text: string) => {
    const el = Array.from(container.querySelectorAll("text")).find(
      (t) => t.textContent === text && t.getAttribute("font-weight") === "700",
    );
    expect(el).toBeDefined();
    return Number(el!.getAttribute("y"));
  };

  it("負の月の値ラベルは横軸の月ラベルの帯に入らない", () => {
    const points: TrendPoint[] = [
      { label: "5月", value: 1_200_000 },
      { label: "6月", value: 300_000 },
      { label: "7月", value: -8_830_000 },
    ];
    const { container } = render(<TrendBars points={points} title="損益" signed />);
    expect(valueLabelY(container, "▲883万円")).toBeLessThan(AXIS_BAND_TOP);
  });

  it("負の値ラベルは棒の下端より下、月ラベルの帯より上に置く", () => {
    const points: TrendPoint[] = [{ label: "7月", value: -8_830_000 }];
    const { container } = render(<TrendBars points={points} title="損益" signed />);
    const bar = container.querySelector('rect[fill="var(--danger)"]')!;
    const barBottom = Number(bar.getAttribute("y")) + Number(bar.getAttribute("height"));
    const y = valueLabelY(container, "▲883万円");
    expect(y).toBeGreaterThan(barBottom);
    expect(y).toBeLessThan(AXIS_BAND_TOP);
  });

  it("棒が細い13ヶ月表示でも負の値ラベルは棒の外に置く(棒幅に依存しない)", () => {
    const points: TrendPoint[] = Array.from({ length: 13 }, (_, i) => ({
      label: `${(i % 12) + 1}月`,
      value: i === 12 ? -8_830_000 : 1_000_000,
    }));
    const { container } = render(<TrendBars points={points} title="損益" signed />);
    const el = Array.from(container.querySelectorAll("text")).find(
      (t) => t.textContent === "▲883万円",
    )!;
    // 白地に白字になる「棒の内側に白で置く」方式を採らないことを固定する
    expect(el.getAttribute("fill")).toBe("var(--ink)");
    expect(Number(el.getAttribute("y"))).toBeLessThan(AXIS_BAND_TOP);
  });

  it("正の月の値ラベルは棒の上に置き、上端で見切れない", () => {
    const points: TrendPoint[] = [
      { label: "5月", value: 12_000_000 },
      { label: "6月", value: 3_000_000 },
    ];
    const { container } = render(<TrendBars points={points} title="売上" />);
    const y = valueLabelY(container, "1,200万円");
    expect(y).toBeGreaterThanOrEqual(11);
    expect(y).toBeLessThan(AXIS_BAND_TOP);
  });

  it("13ヶ月でも月ラベルは間引かれ、左端のラベルが描画域からはみ出さない", () => {
    const points: TrendPoint[] = Array.from({ length: 13 }, (_, i) => ({
      label: i === 0 ? "2025/9月" : `${((i + 8) % 12) + 1}月`,
      value: 1_000_000 + i * 10_000,
    }));
    const { container } = render(<TrendBars points={points} title="売上" />);
    const monthLabels = Array.from(container.querySelectorAll("text")).filter(
      (t) => t.getAttribute("fill") === "var(--ink-muted)",
    );
    expect(monthLabels.length).toBeLessThanOrEqual(10);
    const first = monthLabels[0]!;
    // 中央揃えなので x から左に半分ぶん伸びる。描画域 (PAD_X = 8) の内側に収まること
    expect(Number(first.getAttribute("x"))).toBeGreaterThanOrEqual(8 + 20);
  });

  it("実績の月は円換算の値と前年をtitle要素に出す", () => {
    const points: TrendPoint[] = [{ label: "6月", value: 30000, reference: 25000 }];
    const { container } = render(<TrendBars points={points} title="月次売上" />);
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain("6月: 30,000円 / 前年 25,000円");
  });
});
