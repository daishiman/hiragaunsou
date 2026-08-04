/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

import { DeficitAnalysisButton } from "../../app/(app)/deficit/DeficitAnalysisButton";

describe("DeficitAnalysisButton", () => {
  beforeEach(() => {
    refresh.mockClear();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("押下するとローディング表示になり二重送信を防ぎ、成功するとrouter.refreshを呼ぶ", async () => {
    const user = userEvent.setup();
    let resolveFetch!: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(fetchPromise);

    render(<DeficitAnalysisButton yearMonth="2026-05" />);

    const button = screen.getByRole("button", { name: "AI分析する" });
    await user.click(button);

    // ローディング中は文言が変わり、ボタンはdisabledになる(二重送信防止)
    const loadingButton = await screen.findByRole("button", { name: "AI分析中…" });
    expect(loadingButton).toBeDisabled();

    resolveFetch({
      ok: true,
      json: async () => ({ analyzedCount: 3 }),
    } as Response);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "AI分析する" })).not.toBeDisabled();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/deficit-analysis",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ yearMonth: "2026-05" }),
      }),
    );
  });

  it("APIがエラーを返したときはエラーメッセージを表示し、router.refreshは呼ばない", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "対象月のデータがありません" }),
    } as Response);

    render(<DeficitAnalysisButton yearMonth="2026-05" />);
    await user.click(screen.getByRole("button", { name: "AI分析する" }));

    expect(await screen.findByText("対象月のデータがありません")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "AI分析する" })).not.toBeDisabled();
  });

  it("通信例外が発生したときは「通信エラーが発生しました」を表示する", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    render(<DeficitAnalysisButton yearMonth="2026-05" />);
    await user.click(screen.getByRole("button", { name: "AI分析する" }));

    expect(await screen.findByText("通信エラーが発生しました")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
