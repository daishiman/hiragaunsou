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

  /**
   * 行き先の呼び名は screens.ts から取る。画面ごとに「月次データ取込へ」「データ取込へ進む」と
   * 書き分けていたため、サイドバーの名前と一致していなかった。
   */
  it("行き先の名前をscreens.tsから取る(画面ごとの言い換えをしない)", () => {
    render(<EmptyState title="データがありません" description="まずは取り込みましょう" />);
    const link = screen.getByRole("link", { name: "データ取込へ進む" });
    expect(link).toHaveAttribute("href", "/import");
  });

  it("問い合わせ先を指定すればその画面の名前になる", () => {
    render(
      <EmptyState title="残っている確認はありません" description="片付いています" actionHref="/grid" />,
    );
    expect(
      screen.getByRole("link", { name: "月次収支表（1か月・車両ごと）へ進む" }),
    ).toHaveAttribute("href", "/grid");
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
