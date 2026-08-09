/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MasterFieldEditor } from "../../app/_components/MasterFieldEditor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

/**
 * 一覧の中で1項目だけ直す入力欄。
 *
 * ここで見たいのは「直したあと、その人が次に何を知るか」。
 * 締めた月を据え置いたことを黙っていると「直したのに古い数字のまま」に見えるので、
 * 据え置いた月を必ず言うこと、失敗したら理由が出ることを固定する。
 */
function renderEditor(props?: Partial<Parameters<typeof MasterFieldEditor>[0]>) {
  return render(
    <MasterFieldEditor
      targetKind="driver"
      targetKey="1002"
      field="vehicleNo"
      label="車番"
      value="300"
      {...props}
    />,
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ applied: ["2026-05"], heldBack: [] }),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MasterFieldEditor", () => {
  it("いつもは値だけを出し、直すを押したときに入力欄を出す", async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "直す" }));
    expect(screen.getByRole("textbox", { name: "車番" })).toHaveValue("300");
  });

  it("値が空のときは、空欄ではなく未入力と書く", () => {
    renderEditor({ value: null });
    expect(screen.getByText("未入力")).toBeInTheDocument();
  });

  it("保存すると、直した1項目だけを送る", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "直す" }));
    await user.clear(screen.getByRole("textbox", { name: "車番" }));
    await user.type(screen.getByRole("textbox", { name: "車番" }), "24");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("/api/master-changes/entry");
    expect(JSON.parse(init.body)).toEqual({
      targetKind: "driver",
      targetKey: "1002",
      field: "vehicleNo",
      value: "24",
    });
    expect(await screen.findByText("直しました")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  /** 黙って据え置くと「直したのに反映されていない」に見える */
  it("締めた月を据え置いたときは、どの月がそのままかを言う", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ applied: ["2026-05"], heldBack: ["2026-03", "2026-04"] }),
    });
    renderEditor();

    await user.click(screen.getByRole("button", { name: "直す" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("直しました。締めた月(2026-03・2026-04)はそのままです"),
    ).toBeInTheDocument();
  });

  it("直せなかったときは理由をその場に出し、入力欄は閉じない", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "車番 999 は車両マスタにありません" }),
    });
    renderEditor();

    await user.click(screen.getByRole("button", { name: "直す" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("車番 999 は車両マスタにありません")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "車番" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("通信できなかったときも、押しっぱなしにならない", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error("offline"));
    renderEditor();

    await user.click(screen.getByRole("button", { name: "直す" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("通信できませんでした")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  it("やめるを押したら、入力した内容は送らない", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "直す" }));
    await user.type(screen.getByRole("textbox", { name: "車番" }), "9");
    await user.click(screen.getByRole("button", { name: "やめる" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("300")).toBeInTheDocument();
  });
});
