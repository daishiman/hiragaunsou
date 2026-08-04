/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "../../app/_components/StatTile";

describe("StatTile", () => {
  it("負の増減率は前年比バッジをマイナス表記かつ危険色クラスで表示する", () => {
    render(<StatTile label="売上" value="1,000,000" unit="円" diff={-0.12} />);

    expect(screen.getByText("売上")).toBeInTheDocument();
    expect(screen.getByText("1,000,000")).toBeInTheDocument();
    const badge = screen.getByText("12.0%", { exact: false });
    expect(badge.className).toContain("text-danger");
    expect(badge.textContent?.startsWith("−")).toBe(true);
  });

  it("diffがundefinedのときは増減率行を描画しない", () => {
    render(<StatTile label="走行距離" value="6,000" />);
    expect(screen.queryByText("前年比", { exact: false })).not.toBeInTheDocument();
  });

  it("hrefとlinkLabelが両方揃ったときだけ詳細リンクを描画する", () => {
    const { rerender } = render(
      <StatTile label="赤字台数" value="3" href="/deficit" linkLabel="内訳を見る" />,
    );
    expect(screen.getByRole("link", { name: /内訳を見る/ })).toHaveAttribute("href", "/deficit");

    rerender(<StatTile label="赤字台数" value="3" href="/deficit" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("diffがnullのときは「比較なし」を表す「—」を表示する", () => {
    render(<StatTile label="稼働率" value="80" unit="%" diff={null} />);
    expect(screen.getByText("—", { exact: false })).toBeInTheDocument();
  });

  it("diff2も渡すと前年比とあわせて2本のバッジを表示する", () => {
    render(<StatTile label="売上" value="1,000,000" diff={0.05} diff2={-0.03} />);
    expect(screen.getByText("5.0%", { exact: false })).toBeInTheDocument();
    const diff2Badge = screen.getByText("3.0%", { exact: false });
    expect(diff2Badge.className).toContain("text-danger");
    expect(diff2Badge.textContent?.startsWith("−")).toBe(true);
  });

  it("heroのときは大きい文字サイズのクラスになる", () => {
    render(<StatTile label="経常利益" value="500,000" hero />);
    const value = screen.getByText("500,000");
    expect(value.className).toContain("text-4xl");
  });

  it("negativeのときは主数字を危険色にする", () => {
    render(<StatTile label="経常損失" value="-300,000" negative />);
    const value = screen.getByText("-300,000");
    expect(value.className).toContain("text-danger");
  });

  it("subがあれば補足テキストを表示する", () => {
    render(<StatTile label="走行距離" value="6,000" sub="前月から500km増" />);
    expect(screen.getByText("前月から500km増")).toBeInTheDocument();
  });
});
