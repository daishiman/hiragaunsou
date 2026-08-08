/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepRail } from "../../app/_components/StepRail";

const STEPS = [
  { label: "ファイルを選ぶ", badge: 1 },
  { label: "内容を確認する", badge: 2 },
  { label: "取り込む", badge: 3 },
] as const;

describe("StepRail", () => {
  it("現在地を aria-current で示す", () => {
    render(<StepRail steps={STEPS} currentIndex={1} />);
    expect(screen.getByText("内容を確認する").closest("[aria-current]")).not.toBeNull();
    expect(screen.getByText("ファイルを選ぶ").closest("[aria-current]")).toBeNull();
  });

  it("済んだ手順は色だけでなく記号(✓)でも示す", () => {
    render(<StepRail steps={STEPS} currentIndex={2} />);
    expect(screen.getAllByText("✓")).toHaveLength(2);
  });

  it("onSelectが無ければ押せない表示にする(順番どおりにしか進めない画面向け)", () => {
    render(<StepRail steps={STEPS} currentIndex={0} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("onSelectを渡すと札を押して移動できる", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<StepRail steps={STEPS} currentIndex={2} onSelect={onSelect} />);

    await user.click(screen.getByText("取り込む"));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("trailingに渡した補足(年月など)を右端に出す", () => {
    render(<StepRail steps={STEPS} currentIndex={0} trailing="2026年5月度" />);
    expect(screen.getByText("2026年5月度")).toBeInTheDocument();
  });
});
