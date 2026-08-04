/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListToolbar } from "../../app/_components/ListToolbar";

describe("ListToolbar", () => {
  it("検索欄への入力でonSearchChangeが呼ばれる", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(<ListToolbar searchValue="" onSearchChange={onSearchChange} />);

    await user.type(screen.getByPlaceholderText("車番・荷主・運転者などで検索"), "a");
    expect(onSearchChange).toHaveBeenCalledWith("a");
  });

  it("sortOptionsを渡したときだけ並び替えselectが描画され、選択変更でonSortChangeが呼ばれる", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(
      <ListToolbar
        searchValue=""
        onSearchChange={vi.fn()}
        sortOptions={[
          { value: "date", label: "日付順" },
          { value: "amount", label: "金額順" },
        ]}
        sortValue="date"
        onSortChange={onSortChange}
      />,
    );

    expect(screen.getByText("並び替え", { exact: false })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox"), "amount");
    expect(onSortChange).toHaveBeenCalledWith("amount");
  });

  it("sortOptionsを渡さないときは並び替えUIを描画しない", () => {
    render(<ListToolbar searchValue="" onSearchChange={vi.fn()} />);
    expect(screen.queryByText("並び替え", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("filterChipsを渡さない、または空配列のときは絞り込みUIを描画しない", () => {
    const { rerender } = render(<ListToolbar searchValue="" onSearchChange={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<ListToolbar searchValue="" onSearchChange={vi.fn()} filterChips={[]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("フィルターチップをクリックするとonToggleFilterがそのkeyで呼ばれ、aria-pressedはactiveと一致する", async () => {
    const user = userEvent.setup();
    const onToggleFilter = vi.fn();
    render(
      <ListToolbar
        searchValue=""
        onSearchChange={vi.fn()}
        filterChips={[
          { key: "unresolved", label: "未解決", active: true },
          { key: "resolved", label: "解決済み", active: false },
        ]}
        onToggleFilter={onToggleFilter}
      />,
    );

    const unresolvedBtn = screen.getByRole("button", { name: "未解決" });
    const resolvedBtn = screen.getByRole("button", { name: "解決済み" });
    expect(unresolvedBtn).toHaveAttribute("aria-pressed", "true");
    expect(resolvedBtn).toHaveAttribute("aria-pressed", "false");

    await user.click(resolvedBtn);
    expect(onToggleFilter).toHaveBeenCalledWith("resolved");
  });
});
