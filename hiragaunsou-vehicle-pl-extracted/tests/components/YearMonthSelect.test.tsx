/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { YearMonthSelect } from "../../app/_components/YearMonthSelect";

describe("YearMonthSelect", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("optionsを選択肢として表示し、valueが選択済みになる", () => {
    render(
      <YearMonthSelect basePath="/dashboard" value="2026-05" options={["2026-05", "2026-04", "2026-03"]} />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("2026-05");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("年月を選び直すとbasePathに?ym=を付けてrouter.pushする", async () => {
    const user = userEvent.setup();
    render(
      <YearMonthSelect basePath="/dashboard" value="2026-05" options={["2026-05", "2026-04", "2026-03"]} />,
    );
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "2026-04");
    expect(pushMock).toHaveBeenCalledWith("/dashboard?ym=2026-04");
  });

  it("optionsが1件しかない場合でも描画できる", () => {
    render(<YearMonthSelect basePath="/grid" value="2026-05" options={["2026-05"]} />);
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
