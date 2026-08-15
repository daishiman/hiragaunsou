/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImprovementIssuePanel } from "../../app/(app)/admin/improvements/[id]/ImprovementIssuePanel";

/**
 * 管理画面の「Issue にする」。
 *
 * ここで固定するのは3つ。
 *  1. 中身を見ないまま外へ出せない (下書きを見るまで起票の押し込みができない)
 *  2. 起票済みの要望では押せる場所を作らない (2本目が立たない)
 *  3. 起票先が未設定でも壊れず、下書きまでは使える
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const fetchMock = vi.fn();

describe("ImprovementIssuePanel", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("起票済みなら番号とURLだけを出し、押せる場所を作らない", () => {
    render(
      <ImprovementIssuePanel
        id="improve_abc"
        issueNumber={12}
        issueUrl="https://github.com/x/y/issues/12"
      />,
    );
    expect(screen.getByText(/起票済みです/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Issue #12" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("下書きを見るまでは起票できない", () => {
    render(<ImprovementIssuePanel id="improve_abc" issueNumber={null} issueUrl={null} />);
    const issueButton = screen.getByRole("button", { name: "この内容で Issue にする" });
    expect(issueButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("先に下書きを確認してください。")).toBeTruthy();
  });

  it("下書きは、外へ出る中身をそのまま見せる", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ dryRun: true, configured: true, body: "## 利用者が書いたこと\n> 合計が切れます。" }),
        { status: 200 },
      ),
    );
    render(<ImprovementIssuePanel id="improve_abc" issueNumber={null} issueUrl={null} />);
    await userEvent.click(screen.getByRole("button", { name: "下書きを見る（起票しない）" }));

    await waitFor(() => expect(screen.getByText(/合計が切れます。/)).toBeTruthy());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ dryRun: true });
    // 中身を見た後は押せるようになる。
    expect(
      screen.getByRole("button", { name: "この内容で Issue にする" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("起票先が未設定のときは、その旨を伝えて下書きまでにする", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ dryRun: true, configured: false, body: "本文" }), {
        status: 200,
      }),
    );
    render(<ImprovementIssuePanel id="improve_abc" issueNumber={null} issueUrl={null} />);
    await userEvent.click(screen.getByRole("button", { name: "下書きを見る（起票しない）" }));
    await waitFor(() => expect(screen.getByText(/起票先（リポジトリとトークン）/)).toBeTruthy());
  });

  it("断られたら、その理由を画面に出す", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ dryRun: true, configured: true, body: "本文" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "この要望は Issue #12 として起票済みです。" }), {
          status: 409,
        }),
      );
    render(<ImprovementIssuePanel id="improve_abc" issueNumber={null} issueUrl={null} />);
    await userEvent.click(screen.getByRole("button", { name: "下書きを見る（起票しない）" }));
    await waitFor(() => expect(screen.getByText("本文")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "この内容で Issue にする" }));
    await waitFor(() =>
      expect(screen.getByText("この要望は Issue #12 として起票済みです。")).toBeTruthy(),
    );
  });

  it("通信できないときも、押した結果が分かる", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<ImprovementIssuePanel id="improve_abc" issueNumber={null} issueUrl={null} />);
    await userEvent.click(screen.getByRole("button", { name: "下書きを見る（起票しない）" }));
    await waitFor(() => expect(screen.getByText(/通信できませんでした/)).toBeTruthy());
  });
});
