/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHead } from "../../app/_components/PageHead";

describe("PageHead", () => {
  it("kindごとにKIND_LABELSの文言をバッジとして表示する", () => {
    render(<PageHead kind="ops" title="ホーム" />);
    expect(screen.getByText("毎月の締め")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "ホーム" })).toBeInTheDocument();
  });

  it("kindが異なれば異なるバッジ文言になる", () => {
    render(<PageHead kind="data" title="月次収支表" />);
    expect(screen.getByText("できあがった収支表")).toBeInTheDocument();
    expect(screen.queryByText("毎月の締め")).not.toBeInTheDocument();
  });

  it("leadが無ければ本文は描画しない", () => {
    render(<PageHead kind="analysis" title="ダッシュボード" />);
    expect(screen.queryByText(/期間の損益/)).not.toBeInTheDocument();
  });

  it("leadがあれば本文を描画する", () => {
    render(<PageHead kind="analysis" title="ダッシュボード" lead="期間の損益を確認します" />);
    expect(screen.getByText("期間の損益を確認します")).toBeInTheDocument();
  });

  it("showHomeLinkがtrueのときだけホームへの導線を出す", () => {
    const { rerender } = render(<PageHead kind="ops" title="データ取込" showHomeLink />);
    const link = screen.getByRole("link", { name: /進行状況\(ホーム\)に戻る/ });
    expect(link).toHaveAttribute("href", "/");

    rerender(<PageHead kind="ops" title="データ取込" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("actionが渡されたときだけ右側の要素を描画する", () => {
    const { rerender } = render(
      <PageHead kind="tool" title="利用状況" action={<button type="button">再計算</button>} />,
    );
    expect(screen.getByRole("button", { name: "再計算" })).toBeInTheDocument();

    rerender(<PageHead kind="tool" title="利用状況" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
