/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "../../app/_components/EmptyState";

describe("EmptyState", () => {
  it("titleとdescriptionを表示する", () => {
    render(<EmptyState title="データがありません" description="まずは取り込みましょう" />);
    expect(screen.getByText("データがありません")).toBeInTheDocument();
    expect(screen.getByText("まずは取り込みましょう")).toBeInTheDocument();
  });

  it("actionHref/actionLabel省略時は既定の取込導線を出す", () => {
    render(<EmptyState title="データがありません" description="まずは取り込みましょう" />);
    const link = screen.getByRole("link", { name: "データ取込へ" });
    expect(link).toHaveAttribute("href", "/import");
  });

  it("actionHref/actionLabelを渡すとそちらを表示する", () => {
    render(
      <EmptyState
        title="赤字車両がありません"
        description="対象月を変えて確認してください"
        actionHref="/dashboard"
        actionLabel="ダッシュボードへ"
      />,
    );
    const link = screen.getByRole("link", { name: "ダッシュボードへ" });
    expect(link).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "データ取込へ" })).not.toBeInTheDocument();
  });
});
