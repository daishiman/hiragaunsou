/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StagePanel } from "../../app/_components/StagePanel";
import { Disclosure } from "../../app/_components/Disclosure";

describe("StagePanel", () => {
  it("押すまで中身を出さず、要約だけは開かなくても読める", () => {
    render(
      <StagePanel title="いまの車両マスタ" summary="42台">
        <p>車番の一覧</p>
      </StagePanel>,
    );
    expect(screen.getByText("42台")).toBeInTheDocument();
    expect(screen.queryByText("車番の一覧")).not.toBeInTheDocument();
  });

  it("1クリックで中身に到達し、もう一度押すと閉じる", async () => {
    const user = userEvent.setup();
    render(
      <StagePanel title="いまの車両マスタ">
        <p>車番の一覧</p>
      </StagePanel>,
    );

    await user.click(screen.getByRole("button", { name: "開く" }));
    expect(screen.getByText("車番の一覧")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByText("車番の一覧")).not.toBeInTheDocument();
  });

  it("defaultOpenを指定した画面は最初から開いた状態にできる", () => {
    render(
      <StagePanel title="いまの車両マスタ" defaultOpen>
        <p>車番の一覧</p>
      </StagePanel>,
    );
    expect(screen.getByText("車番の一覧")).toBeInTheDocument();
  });
});

describe("Disclosure", () => {
  it("畳んだ状態でも見出しは読める(何が入っているか分かる)", () => {
    render(
      <Disclosure summary="どのファイルを選べばよいですか?">
        <p>社内Excelをそのまま選んでください。</p>
      </Disclosure>,
    );
    expect(screen.getByText("どのファイルを選べばよいですか?")).toBeInTheDocument();
  });

  it("見出しを押すと中身が開く", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure summary="どのファイルを選べばよいですか?">
        <p>社内Excelをそのまま選んでください。</p>
      </Disclosure>,
    );

    const details = screen.getByText("どのファイルを選べばよいですか?").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");

    await user.click(screen.getByText("どのファイルを選べばよいですか?"));
    expect(details).toHaveAttribute("open");
  });
});
