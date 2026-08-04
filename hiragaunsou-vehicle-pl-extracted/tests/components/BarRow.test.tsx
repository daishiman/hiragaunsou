/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BarRow } from "../../app/_components/BarRow";

function getFillBar(container: HTMLElement) {
  return container.querySelector(".h-full.rounded-full") as HTMLElement;
}

describe("BarRow", () => {
  it("labelとdisplayの数値を表示する", () => {
    render(<BarRow label="1号車" value={80} max={100} display="80万円" />);
    expect(screen.getByText("1号車")).toBeInTheDocument();
    expect(screen.getByText("80万円")).toBeInTheDocument();
  });

  it("value/maxの比率どおりに棒の幅を決める", () => {
    const { container } = render(<BarRow label="2号車" value={25} max={100} display="25" />);
    const fill = getFillBar(container);
    expect(fill.style.width).toBe("25%");
  });

  it("valueがmaxを超える場合は100%で頭打ちにする", () => {
    const { container } = render(<BarRow label="3号車" value={150} max={100} display="150" />);
    const fill = getFillBar(container);
    expect(fill.style.width).toBe("100%");
  });

  it("maxが0以下のときは棒を描かない(幅0%)", () => {
    const { container } = render(<BarRow label="4号車" value={50} max={0} display="50" />);
    const fill = getFillBar(container);
    expect(fill.style.width).toBe("0%");
  });

  it("負の値も絶対値で比率を計算する", () => {
    const { container } = render(<BarRow label="5号車" value={-40} max={100} display="▲40" />);
    const fill = getFillBar(container);
    expect(fill.style.width).toBe("40%");
  });

  it("toneに応じて塗り色クラスを切り替える", () => {
    const danger = render(<BarRow label="赤字車両" value={10} max={100} display="10" tone="danger" />);
    expect(getFillBar(danger.container).className).toContain("bg-danger");
    danger.unmount();

    const quiet = render(<BarRow label="参考車両" value={10} max={100} display="10" tone="quiet" />);
    expect(getFillBar(quiet.container).className).toContain("bg-ink-muted/40");
    quiet.unmount();

    const brand = render(<BarRow label="通常車両" value={10} max={100} display="10" />);
    expect(getFillBar(brand.container).className).toContain("bg-brand");
  });

  it("toneがdangerのとき数値ラベルも危険色クラスになる", () => {
    render(<BarRow label="赤字車両" value={10} max={100} display="10万円" tone="danger" />);
    expect(screen.getByText("10万円").className).toContain("text-danger");
  });

  it("subが無ければ補足行を描画しない", () => {
    render(<BarRow label="1号車" value={80} max={100} display="80" />);
    expect(screen.queryByText(/補足/)).not.toBeInTheDocument();
  });

  it("subがあれば補足行を描画する", () => {
    render(<BarRow label="1号車" value={80} max={100} display="80" sub="前月比+5%" />);
    expect(screen.getByText("前月比+5%")).toBeInTheDocument();
  });
});
