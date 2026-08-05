/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CleansingQueue } from "../../app/(app)/cleansing/CleansingQueue";
import type { CleansingQueueItem } from "../../src/usecase/steps/getCleansingQueue";

function makeItem(overrides: Partial<CleansingQueueItem> = {}): CleansingQueueItem {
  return {
    rowKey: "1-1",
    vehicleNo: "24",
    driverName: "山田",
    customerName: "キリン物流",
    loadDate: "2026-05-10",
    amount: 12000,
    flags: [{ type: "misc_entry", severity: "review", reason: "運転者が「諸口」として登録されています" }],
    decision: null,
    correctedVehicleNo: null,
    note: null,
    suggestion: null,
    clusterKey: "",
    ...overrides,
  };
}

describe("CleansingQueue", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("未取込のときは取込導線だけを表示する", () => {
    render(
      <CleansingQueue
        yearMonth="2026-05"
        initialItems={[]}
        charteredExcluded={0}
        totalRows={0}
        notImported
        canDecide
      />,
    );
    expect(screen.getByText("売上モニタリストが未取込です")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "データ取込へ進む" })).toHaveAttribute(
      "href",
      "/import?ym=2026-05",
    );
  });

  it("「除外する」を押すと保存APIを呼び、未判断件数が減って完了メッセージに切り替わる", async () => {
    const user = userEvent.setup();
    const item = makeItem();
    render(
      <CleansingQueue
        yearMonth="2026-05"
        initialItems={[item]}
        charteredExcluded={2}
        totalRows={100}
        notImported={false}
        canDecide
      />,
    );

    const deleteButtons = screen.getAllByRole("button", { name: "除外する" });
    await user.click(deleteButtons[0]!);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/cleansing",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"decision":"delete"'),
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("✓ すべて判断済み")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "次のステップへ進む" })).toHaveAttribute(
      "href",
      "/manual-entry?step=2&ym=2026-05",
    );
  });

  it("保存に失敗すると判断が元に戻りエラーメッセージが表示される", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "保存に失敗しました(競合)" }),
    } as Response);
    const item = makeItem();
    render(
      <CleansingQueue
        yearMonth="2026-05"
        initialItems={[item]}
        charteredExcluded={0}
        totalRows={10}
        notImported={false}
        canDecide
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "除外する" })[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent("保存に失敗しました(競合)");
    // 保存失敗時は判断が巻き戻るため、未判断件数は1のまま
    expect(screen.queryByText("✓ すべて判断済み")).not.toBeInTheDocument();
  });

  it("「修正して残す」を選ぶと正しい車番の入力欄が出て、フォーカスを外すと保存する", async () => {
    const user = userEvent.setup();
    const item = makeItem({ rowKey: "2-1", vehicleNo: "10" });
    render(
      <CleansingQueue
        yearMonth="2026-05"
        initialItems={[item]}
        charteredExcluded={0}
        totalRows={10}
        notImported={false}
        canDecide
      />,
    );

    await user.click(screen.getByRole("button", { name: "修正して残す" }));
    const vehicleInput = await screen.findByPlaceholderText("例: 24");
    await user.type(vehicleInput, "300");
    await user.tab();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        "/api/cleansing",
        expect.objectContaining({
          body: expect.stringContaining('"correctedVehicleNo":"300"'),
        }),
      );
    });
  });

  it("検索でフラグ対象を絞り込める", async () => {
    const user = userEvent.setup();
    const items = [
      makeItem({ rowKey: "a", vehicleNo: "24", driverName: "山田" }),
      makeItem({ rowKey: "b", vehicleNo: "999", driverName: "鈴木" }),
    ];
    render(
      <CleansingQueue
        yearMonth="2026-05"
        initialItems={items}
        charteredExcluded={0}
        totalRows={10}
        notImported={false}
        canDecide
      />,
    );

    expect(screen.getByText("車番 24")).toBeInTheDocument();
    expect(screen.getByText("車番 999")).toBeInTheDocument();

    const search = screen.getByPlaceholderText("車番・運転者・荷主で検索");
    await user.type(search, "鈴木");

    expect(screen.queryByText("車番 24")).not.toBeInTheDocument();
    expect(screen.getByText("車番 999")).toBeInTheDocument();
  });
});
