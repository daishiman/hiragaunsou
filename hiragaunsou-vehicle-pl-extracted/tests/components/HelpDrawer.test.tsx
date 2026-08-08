/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpDrawer } from "../../app/_components/HelpDrawer";

/**
 * 「?」と引き出しの組。
 * この部品の役目は「文章を消さずに、出すタイミングを後ろへ移す」ことなので、
 * 初期表示に本文が出ていないことと、1クリックで全文に届くことの両方を確かめる。
 */
describe("HelpDrawer", () => {
  it("初期表示では本文を出さず、ボタンは「?」の1文字だけにする", () => {
    render(
      <HelpDrawer title="この画面の数字の出どころ">
        <p>この画面の数字は月次収支表から来ています。</p>
      </HelpDrawer>,
    );

    expect(screen.queryByText("この画面の数字は月次収支表から来ています。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この画面について" })).toHaveTextContent("?");
  });

  it("1クリックで本文の全文に到達できる", async () => {
    const user = userEvent.setup();
    render(
      <HelpDrawer title="この画面の数字の出どころ">
        <p>この画面の数字は月次収支表から来ています。</p>
      </HelpDrawer>,
    );

    await user.click(screen.getByRole("button", { name: "この画面について" }));

    expect(screen.getByRole("dialog", { name: "この画面の数字の出どころ" })).toBeInTheDocument();
    expect(screen.getByText("この画面の数字は月次収支表から来ています。")).toBeInTheDocument();
  });

  it("閉じるボタンで元の画面に戻る", async () => {
    const user = userEvent.setup();
    render(
      <HelpDrawer title="この画面の数字の出どころ" label="この画面の数字の出どころ">
        <p>この画面の数字は月次収支表から来ています。</p>
      </HelpDrawer>,
    );

    await user.click(screen.getByRole("button", { name: "この画面の数字の出どころ" }));
    await user.click(screen.getByRole("button", { name: "閉じる" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escでも閉じられる(引き出しの外に戻る手段を1つに絞らない)", async () => {
    const user = userEvent.setup();
    render(
      <HelpDrawer title="この画面の数字の出どころ">
        <p>この画面の数字は月次収支表から来ています。</p>
      </HelpDrawer>,
    );

    await user.click(screen.getByRole("button", { name: "この画面について" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
