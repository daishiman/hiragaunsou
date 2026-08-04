/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace, push: vi.fn() }),
}));

import { ImportForm } from "../../app/(app)/import/ImportForm";

/** 対象帳票の見出しから、その帳票専用のファイル選択inputを取り出す */
function fileInputFor(headingName: string): HTMLInputElement {
  const heading = screen.getByRole("heading", { name: headingName });
  const container = heading.closest("section");
  if (!container) throw new Error(`section not found for ${headingName}`);
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error(`file input not found for ${headingName}`);
  return input as HTMLInputElement;
}

describe("ImportForm", () => {
  beforeEach(() => {
    refresh.mockClear();
    replace.mockClear();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ファイルを選ぶと取込中表示を経て成功メッセージを出し、router.refreshで一覧へ反映する", async () => {
    const user = userEvent.setup();
    let resolveFetch!: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(fetchPromise);

    render(<ImportForm yearMonth="2026-05" imported={{}} />);

    const input = fileInputFor("車両別運行実績表");
    const file = new File(["a,b,c"], "operation.csv", { type: "text/csv" });
    await user.upload(input, file);

    expect(await screen.findByText("取り込んでいます…")).toBeInTheDocument();

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({ vehicleCount: 12, charteredExcluded: 1 }),
    } as Response);

    expect(
      await screen.findByText(/operation\.csv: 車両 12 台 ／ 傭車 1 件を除外/),
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/import/vehicle_operation",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("同じ帳票が取込済みのときは入れ直し確認を出し、承認すると置き換えて取込む", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          conflict: {
            sameFileName: true,
            superseded: [{ fileName: "operation.csv", rowCount: 10, importedAt: Date.now() }],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ vehicleCount: 12 }),
      } as Response);

    render(<ImportForm yearMonth="2026-05" imported={{}} />);

    const input = fileInputFor("車両別運行実績表");
    const file = new File(["a,b,c"], "operation.csv", { type: "text/csv" });
    await user.upload(input, file);

    expect(
      await screen.findByText("「operation.csv」は既に取り込み済みです。入れ直しますか?"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "削除して入れ直す" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        "/api/import/vehicle_operation",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText(/operation\.csv: 車両 12 台/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("サーバーに接続できない場合は通信エラーメッセージを表示し、一覧は更新しない", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));

    render(<ImportForm yearMonth="2026-05" imported={{}} />);

    const input = fileInputFor("車両別運行実績表");
    const file = new File(["a,b,c"], "operation.csv", { type: "text/csv" });
    await user.upload(input, file);

    expect(
      await screen.findByText((_, element) =>
        element?.tagName === "P" && (element.textContent ?? "").includes("サーバーに接続できませんでした"),
      ),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
