/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  InstructionTokenTable,
  type TokenRow,
} from "../../app/(app)/admin/improvements/tokens/InstructionTokenTable";

/**
 * 鍵の一覧と「止める」操作。
 *
 * ここで固定するのは、鍵の扱いを間違えないための3つ。
 *  1. 使える鍵と、期限切れ・止めた鍵が、見て区別できる
 *  2. 止められるのは使える鍵だけ (止めた鍵にもう一度ボタンが出ない)
 *  3. 押した瞬間には止まらず、何を止めるかを名前で見せてから確認する
 *
 * 鍵の平文はそもそもこの画面へ渡ってこない (保存しているのは指紋だけ)。
 */

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

function row(over: Partial<TokenRow> = {}): TokenRow {
  return {
    id: "tok_1",
    name: "1件を渡すための鍵",
    scopeLabel: "1件",
    createdLabel: "今西・2026/08/15 10:00",
    expiresLabel: "2026/08/22 10:00",
    usageLabel: "まだ使われていません",
    state: "active",
    stateNote: "使えます",
    ...over,
  };
}

const ROWS: TokenRow[] = [
  row(),
  row({ id: "tok_2", name: "期限が切れた鍵", state: "expired", stateNote: "期限切れ" }),
  row({
    id: "tok_3",
    name: "止めた鍵",
    state: "revoked",
    stateNote: "失効済み（渡す相手が変わったため）",
  }),
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("InstructionTokenTable", () => {
  it("使える鍵・期限切れ・止めた鍵を、状態の言葉で見分けられる", () => {
    render(<InstructionTokenTable rows={ROWS} />);
    const stateOf = (name: string) =>
      within(screen.getByText(name).closest("tr")!).getAllByText(
        /使えます|期限切れ|止めました/,
      )[0]!.textContent;

    expect(stateOf("1件を渡すための鍵")).toBe("使えます");
    expect(stateOf("期限が切れた鍵")).toBe("期限切れ");
    // 期限切れと止めた鍵は、同じ「使えない」でも言葉を分ける。
    expect(stateOf("止めた鍵")).toBe("止めました");
    // 止めた理由も一覧に残る（後から経緯をたどれる）。
    expect(screen.getByText("失効済み（渡す相手が変わったため）")).toBeTruthy();
  });

  it("止められるのは、いま使える鍵だけ", () => {
    render(<InstructionTokenTable rows={ROWS} />);
    // 3本あっても、押せるのは1本ぶん。
    expect(screen.getAllByRole("button", { name: "止める" })).toHaveLength(1);

    const expired = screen.getByText("期限が切れた鍵").closest("tr")!;
    expect(within(expired).queryByRole("button", { name: "止める" })).toBeNull();
  });

  it("押しただけでは止まらず、何を止めるかを名前で見せて確認する", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<InstructionTokenTable rows={ROWS} />);

    await userEvent.click(screen.getByRole("button", { name: "止める" }));

    expect(
      screen.getByText("「1件を渡すための鍵」を止めます。この鍵では読めなくなります。"),
    ).toBeTruthy();
    // 確認を出しただけの段階では、まだ何も送っていない。
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(screen.queryByRole("button", { name: "この鍵を止める" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("確認して止めると、書いた理由も一緒に送る", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({ ok: true, json: async () => ({ message: "鍵を止めました。" }) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<InstructionTokenTable rows={ROWS} />);

    await userEvent.click(screen.getByRole("button", { name: "止める" }));
    await userEvent.type(
      screen.getByLabelText(/理由/),
      "渡す相手が変わったため",
    );
    await userEvent.click(screen.getByRole("button", { name: "この鍵を止める" }));

    await waitFor(() => expect(screen.getByText("鍵を止めました。")).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/improvements/tokens/tok_1");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "渡す相手が変わったため" });
    // 一覧を出し直して、止めた鍵が「使えます」のまま残らないようにする。
    expect(refreshMock).toHaveBeenCalled();
  });

  it("止められなかったときは理由を出し、成功の知らせは出さない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            json: async () => ({ message: "その鍵は見つかりませんでした。" }),
          }) as unknown as Response,
      ),
    );
    render(<InstructionTokenTable rows={ROWS} />);

    await userEvent.click(screen.getByRole("button", { name: "止める" }));
    await userEvent.click(screen.getByRole("button", { name: "この鍵を止める" }));

    await waitFor(() => expect(screen.getByText("その鍵は見つかりませんでした。")).toBeTruthy());
    expect(screen.queryByText("鍵を止めました。")).toBeNull();
  });
});
