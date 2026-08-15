/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueAllScopeTokenForm } from "../../app/(app)/admin/improvements/tokens/IssueAllScopeTokenForm";

/**
 * 「発行済みのすべてを読める鍵」を作る入口。
 *
 * 一番強い鍵なので、ここで固定するのは重みの掛け方。
 *  1. 既定では閉じている (探して開いた人だけが使う)
 *  2. 何ができる鍵かを、押す前に言い切る
 *  3. 理由を書くまで先へ進めない
 *  4. 作る前にもう一度、範囲と期限を見せて確認する
 *  5. 鍵の入った文が出るのは、作ったあとの1回だけ
 *
 * サーバ側でも同じ条件を確かめている (tests/api/instructionRoutes.test.ts)。
 * 画面の作りだけで止めていると、API を直に叩けば外せることになるため。
 */

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const COMMAND = "curl -H 'authorization: Bearer hgcc_all123' https://example.test/api/instructions";

function stubFetch(res: { ok?: boolean; json: unknown }) {
  const fetchMock = vi.fn(
    async () => ({ ok: res.ok ?? true, json: async () => res.json }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("IssueAllScopeTokenForm", () => {
  it("既定では閉じていて、ふだんは使わないことを添える", () => {
    render(<IssueAllScopeTokenForm />);
    expect(screen.getByRole("button", { name: "発行済みのすべてを読める鍵を作る" })).toBeTruthy();
    expect(screen.getByText(/ふだんは使いません/)).toBeTruthy();
    expect(screen.queryByLabelText(/何のために作るか/)).toBeNull();
  });

  it("開くと、何ができる鍵かを作る前に言い切る", async () => {
    render(<IssueAllScopeTokenForm />);
    await userEvent.click(screen.getByRole("button", { name: "発行済みのすべてを読める鍵を作る" }));

    expect(screen.getByText(/いま発行済みの指示文をすべて読めます/)).toBeTruthy();
    expect(screen.getByText(/以後に発行した分まで読めます/)).toBeTruthy();
  });

  it("理由を書くまで先へ進めない", async () => {
    render(<IssueAllScopeTokenForm />);
    await userEvent.click(screen.getByRole("button", { name: "発行済みのすべてを読める鍵を作る" }));

    const next = screen.getByRole("button", { name: "作る内容を確認する" });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("先に理由を書いてください。")).toBeTruthy();

    await userEvent.type(screen.getByLabelText(/何のために作るか/), "溜まった要望をまとめて棚卸しするため");
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });

  it("作る前に、範囲と期限をもう一度見せてから作る", async () => {
    const fetchMock = stubFetch({
      json: { command: COMMAND, expiresAt: "2026-08-16T00:00:00.000Z" },
    });
    render(<IssueAllScopeTokenForm />);
    await userEvent.click(screen.getByRole("button", { name: "発行済みのすべてを読める鍵を作る" }));
    await userEvent.type(screen.getByLabelText(/何のために作るか/), "溜まった要望をまとめて棚卸しするため");
    await userEvent.selectOptions(screen.getByLabelText("期限"), "2");
    await userEvent.click(screen.getByRole("button", { name: "作る内容を確認する" }));

    expect(
      screen.getByText("発行済みのすべてを読める鍵を、2日間だけ使える形で作ります。"),
    ).toBeTruthy();
    // 確認を出しただけの段階では、まだ作っていない。
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "この内容で鍵を作る" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // 範囲が空＝全件。何を作るかを画面の状態から組み立てない。
    expect(JSON.parse(String(init.body))).toMatchObject({
      ids: [],
      days: 2,
      reason: "溜まった要望をまとめて棚卸しするため",
    });
  });

  it("作れたら、鍵の入った文が1回だけ出る（範囲もそこに書く）", async () => {
    stubFetch({ json: { command: COMMAND, expiresAt: "2026-08-16T00:00:00.000Z" } });
    render(<IssueAllScopeTokenForm />);
    await userEvent.click(screen.getByRole("button", { name: "発行済みのすべてを読める鍵を作る" }));
    await userEvent.type(screen.getByLabelText(/何のために作るか/), "溜まった要望をまとめて棚卸しするため");
    await userEvent.click(screen.getByRole("button", { name: "作る内容を確認する" }));
    await userEvent.click(screen.getByRole("button", { name: "この内容で鍵を作る" }));

    const box = await screen.findByLabelText("Claude Code に貼る文");
    expect((box as HTMLTextAreaElement).value).toBe(COMMAND);
    expect(screen.getByText(/発行済みのすべてを読める鍵が入っています/)).toBeTruthy();
    const shown = screen.queryAllByText(COMMAND);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toBe(box);
  });

  it("断られたら理由を出し、鍵の文は出さない", async () => {
    stubFetch({ ok: false, json: { message: "全件を読める鍵の有効期間は1日〜3日で指定してください。" } });
    render(<IssueAllScopeTokenForm />);
    await userEvent.click(screen.getByRole("button", { name: "発行済みのすべてを読める鍵を作る" }));
    await userEvent.type(screen.getByLabelText(/何のために作るか/), "溜まった要望をまとめて棚卸しするため");
    await userEvent.click(screen.getByRole("button", { name: "作る内容を確認する" }));
    await userEvent.click(screen.getByRole("button", { name: "この内容で鍵を作る" }));

    await waitFor(() =>
      expect(
        screen.getByText("全件を読める鍵の有効期間は1日〜3日で指定してください。"),
      ).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Claude Code に貼る文")).toBeNull();
  });
});
