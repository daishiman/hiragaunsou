/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendBars, type TrendPoint } from "../../../app/_components/charts/TrendBars";

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

  it("実績の月は円換算の値と前年をtitle要素に出す", () => {
    const points: TrendPoint[] = [{ label: "6月", value: 30000, reference: 25000 }];
    const { container } = render(<TrendBars points={points} title="月次売上" />);
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain("6月: 30,000円 / 前年 25,000円");
  });
});
