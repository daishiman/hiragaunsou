/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnomalyQueue } from "../../app/(app)/anomaly/AnomalyQueue";
import type { AnomalyQueueItem } from "../../src/usecase/steps/getAnomalyQueue";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

function makeItem(overrides: Partial<AnomalyQueueItem> = {}): AnomalyQueueItem {
  return {
    id: "item-1",
    vehicleNo: "24",
    field: "fuelOut",
    type: "spike",
    message: "軽油代(外)がいつもより高い値です",
    priority: "高",
    value: 90000,
    median: 30000,
    ratioToMedian: 3,
    spark: [
      { yearMonth: "2026-04", label: "4月", value: 30000 },
      { yearMonth: "2026-05", label: "5月", value: 90000 },
    ],
    recommendation: "corrected",
    ...overrides,
  };
}

describe("AnomalyQueue", () => {
  beforeEach(() => {
    refresh.mockClear();
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("推奨された判定を押すと保存APIが呼ばれ、取り消し線つきの直前判定が出て次の項目に進む", async () => {
    const user = userEvent.setup();
    const items = [makeItem({ id: "a", vehicleNo: "24" }), makeItem({ id: "b", vehicleNo: "300" })];
    render(<AnomalyQueue items={items} yearMonth="2026-05" canApprove />);

    expect(screen.getByText("1 / 2 件目")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /車番 24/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /入力ミス — 直しに送る/ }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/todo/a/resolve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "corrected" }),
      }),
    );

    // 2件目に進み、直前の判定が取り消し可能な形で出る
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /車番 300/ })).toBeInTheDocument();
    });
    expect(screen.getByText(/直前: 車番 24 \/.*入力ミス — 直しに送る/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取り消す" }));
    expect(global.fetch).toHaveBeenLastCalledWith(
      "/api/todo/a/resolve",
      expect.objectContaining({ body: JSON.stringify({ action: "reopen" }) }),
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /車番 24/ })).toBeInTheDocument();
    });
  });

  it("保存に失敗するとエラーメッセージを表示し、件数は進まない", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const items = [makeItem({ id: "a" })];
    render(<AnomalyQueue items={items} yearMonth="2026-05" canApprove />);

    await user.click(screen.getByRole("button", { name: /入力ミス — 直しに送る/ }));

    expect(await screen.findByText(/判定を保存できませんでした/)).toBeInTheDocument();
    expect(screen.getByText("1 / 1 件目")).toBeInTheDocument();
  });

  it("承認権限がない場合は判定ボタンを出さず、閲覧のみである旨を表示する", () => {
    const items = [makeItem()];
    render(<AnomalyQueue items={items} yearMonth="2026-05" canApprove={false} />);

    expect(screen.getByText("判定するには承認権限が必要です。閲覧のみ可能です。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /入力ミス — 直しに送る/ })).not.toBeInTheDocument();
  });

  it("全件判定済みのときは完了メッセージとダッシュボードへの導線を表示する", () => {
    render(<AnomalyQueue items={[]} yearMonth="2026-05" canApprove />);

    expect(screen.getByText("この月の異常値はすべて判定済みです")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ダッシュボードへ" })).toHaveAttribute(
      "href",
      "/dashboard?ym=2026-05",
    );
  });

  it("待ち行列の検索で絞り込み、クリックでその項目へ直接ジャンプできる", async () => {
    const user = userEvent.setup();
    const items = [
      makeItem({ id: "a", vehicleNo: "24" }),
      makeItem({ id: "b", vehicleNo: "300" }),
    ];
    render(<AnomalyQueue items={items} yearMonth="2026-05" canApprove />);

    const search = screen.getByPlaceholderText("車番・項目で検索");
    await user.type(search, "300");

    // サイドバーの絞り込み結果に300のみ表示される
    const list = screen.getAllByRole("button").filter((b) => b.textContent?.includes("300"));
    expect(list.length).toBeGreaterThan(0);

    await user.click(list[0]!);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /車番 300/ })).toBeInTheDocument();
    });
  });
});
