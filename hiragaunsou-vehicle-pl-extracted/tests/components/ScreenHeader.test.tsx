/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ScreenHeader } from "../../app/_components/ScreenHeader";
import { getScreen } from "../../app/_lib/screens";

describe("ScreenHeader", () => {
  it("定義ファイルの見出し・リード文をそのまま描く(ページ側は画面パスを渡すだけ)", () => {
    const def = getScreen("/cleansing")!;
    render(<ScreenHeader screen="/cleansing" />);
    expect(screen.getByRole("heading", { level: 1, name: def.title })).toBeInTheDocument();
    expect(screen.getByText(def.lead)).toBeInTheDocument();
  });

  it("することはリード文に集約し、doesを説明カードとして重複表示しない", () => {
    const def = getScreen("/cleansing")!;
    render(<ScreenHeader screen="/cleansing" />);
    expect(screen.getByText(def.lead)).toBeInTheDocument();
    expect(screen.queryByText(def.does)).not.toBeInTheDocument();
    expect(screen.queryByText("この画面ですること")).not.toBeInTheDocument();
  });

  it("紛らわしい画面との境界だけを簡潔に表示する", () => {
    const def = getScreen("/cleansing")!;
    render(<ScreenHeader screen="/cleansing" />);
    const boundary = screen.getByLabelText("この画面の範囲");
    expect(boundary).not.toHaveClass("card");
    expect(within(boundary).getByText(def.notHere!.text)).toBeInTheDocument();
    expect(within(boundary).getByRole("link", { name: /月次収支表/ })).toBeInTheDocument();
    expect(screen.queryByText(def.next!.text)).not.toBeInTheDocument();
  });

  it("毎月の締めの画面では、工程の何番目かと前後の画面が出る", () => {
    render(<ScreenHeader screen="/manual-entry" />);
    const flow = screen.getByRole("navigation", { name: "毎月の締めの進行" });
    expect(flow.textContent).toContain("毎月の締め");
    expect(within(flow).getByRole("link", { name: getScreen("/cleansing")!.label })).toBeInTheDocument();
    expect(within(flow).getByRole("link", { name: getScreen("/anomaly")!.label })).toBeInTheDocument();
  });

  it("工程外のnextは説明やリンクを重ねず、画面内の主要操作に任せる", () => {
    const def = getScreen("/dashboard")!;
    render(<ScreenHeader screen="/dashboard" />);
    expect(screen.queryByRole("navigation", { name: "毎月の締めの進行" })).not.toBeInTheDocument();
    expect(screen.queryByText(def.next!.text)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /赤字の理由/ })).not.toBeInTheDocument();
  });

  it("締めの最終工程では定義済みの次画面を工程ナビの出口として出す", () => {
    render(<ScreenHeader screen="/grid" />);
    const flow = screen.getByRole("navigation", { name: "毎月の締めの進行" });
    expect(within(flow).getByRole("link", { name: "年間集計・対前年" })).toHaveAttribute(
      "href",
      "/annual",
    );
  });

  it("対象月や車番を含む見出しだけは上書きできる", () => {
    render(<ScreenHeader screen="/vehicle" title="車番 1234" lead="2026年3月" />);
    expect(screen.getByRole("heading", { level: 1, name: "車番 1234" })).toBeInTheDocument();
    expect(screen.getByText("2026年3月")).toBeInTheDocument();
  });

  it("未登録の画面でも見出しだけは描いて落ちない", () => {
    render(<ScreenHeader screen="/no-such-page" title="未登録" />);
    expect(screen.getByRole("heading", { level: 1, name: "未登録" })).toBeInTheDocument();
    expect(screen.queryByLabelText("この画面の範囲")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "毎月の締めの進行" })).not.toBeInTheDocument();
  });
});
