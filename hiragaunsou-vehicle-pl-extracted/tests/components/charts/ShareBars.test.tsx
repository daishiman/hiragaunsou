/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShareBars } from "../../../app/_components/charts/ShareBars";

describe("ShareBars", () => {
  it("itemsが空なら何も描画しない", () => {
    const { container } = render(<ShareBars items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shareがnullのときは構成比(%)を表示しない", () => {
    render(<ShareBars items={[{ label: "車番1", value: 100000, share: null }]} />);
    expect(screen.getByText("車番1")).toBeInTheDocument();
    expect(screen.queryByText("%", { exact: false })).not.toBeInTheDocument();
  });

  it("shareが数値のときは構成比(%)を表示する", () => {
    render(<ShareBars items={[{ label: "車番2", value: 100000, share: 0.5 }]} />);
    expect(screen.getByText("50.0%", { exact: false })).toBeInTheDocument();
  });

  it("hrefがあればリンク、無ければリンクにしない", () => {
    render(
      <ShareBars
        items={[
          { label: "リンク有り", value: 100, href: "/vehicle/1" },
          { label: "リンク無し", value: 50 },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /リンク有り/ })).toHaveAttribute("href", "/vehicle/1");
    expect(screen.queryByRole("link", { name: /リンク無し/ })).not.toBeInTheDocument();
    expect(screen.getByText("リンク無し")).toBeInTheDocument();
  });

  it("subがあれば併記する", () => {
    render(<ShareBars items={[{ label: "車番3", sub: "田中", value: 100 }]} />);
    expect(screen.getByText("田中")).toBeInTheDocument();
  });

  it("全item値が0でもゼロ除算せずバー幅を最小1%にする", () => {
    render(<ShareBars items={[{ label: "ゼロ台", value: 0 }]} />);
    const bar = document.querySelector(".bg-brand") as HTMLElement;
    expect(bar.style.width).toBe("1%");
  });

  it("tone=dangerのときは危険色のバーを使う", () => {
    render(<ShareBars items={[{ label: "赤字車両", value: 100 }]} tone="danger" />);
    expect(document.querySelector(".bg-danger")).toBeInTheDocument();
    expect(document.querySelector(".bg-brand")).not.toBeInTheDocument();
  });

  it("formatValueを渡すとその整形結果を使う", () => {
    render(
      <ShareBars items={[{ label: "距離", value: 1234 }]} formatValue={(v) => `${v}km`} />,
    );
    expect(screen.getByText("1234km")).toBeInTheDocument();
  });
});
