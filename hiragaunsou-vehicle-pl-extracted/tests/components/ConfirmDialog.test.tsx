/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "../../app/_components/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("閉じているあいだは何も描かない", () => {
    render(
      <ConfirmDialog
        open={false}
        title="このユーザーを削除します"
        confirmLabel="削除する"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("何を消すのかを本文に出せる(標準のconfirmではできなかったこと)", () => {
    render(
      <ConfirmDialog
        open
        title="この取込データを削除します"
        confirmLabel="削除する"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      >
        <p>2026-05 / 給与集計表 / payroll.csv(87行)</p>
      </ConfirmDialog>,
    );
    expect(screen.getByText("2026-05 / 給与集計表 / payroll.csv(87行)")).toBeInTheDocument();
  });

  it("開いた直後の焦点は「やめる」に置く(Enter押しっぱなしで消さないため)", () => {
    render(
      <ConfirmDialog
        open
        title="このユーザーを削除します"
        confirmLabel="削除する"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "やめる" }));
  });

  it("確定・取消のそれぞれが対応する処理だけを呼ぶ", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="このユーザーを削除します"
        confirmLabel="削除する"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "やめる" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escでも取り消せる", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="このユーザーを削除します"
        confirmLabel="削除する"
        onConfirm={() => undefined}
        onCancel={onCancel}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
