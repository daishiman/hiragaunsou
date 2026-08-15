/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueCiTokenForm } from "../../app/(app)/admin/improvements/tokens/IssueCiTokenForm";

/**
 * GitHub Actions に置く鍵を作る入口。
 *
 * ここで固定するのは、開発者用の鍵との取り違えを起こさないこと。
 * 取り違えて読める鍵を GitHub の保管庫に置くと、保管庫が漏れた日に
 * 要望の中身まで一緒に出ていく。だから画面には次の3つを求める。
 *  1. 「指示文は読めない」と、作る前に書いてある
 *  2. purpose を必ず ci として送る (画面の状態から組み立てない)
 *  3. 何に使うかを書くまで作れない (置きっぱなしの鍵の由来を残す)
 *
 * サーバ側でも同じ条件を確かめている (tests/api/instructionRoutes.test.ts)。
 */

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const TOKEN = "hgcc_ci_TESTONLYzzzzzzzzzzzzzzzzzzz";

function stubFetch(res: { ok?: boolean; json: unknown }) {
  const fetchMock = vi.fn(
    async () => ({ ok: res.ok ?? true, json: async () => res.json }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function open() {
  render(<IssueCiTokenForm />);
  await userEvent.click(screen.getByRole("button", { name: "GitHub Actions 用の鍵を作る" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("IssueCiTokenForm", () => {
  it("既定では閉じていて、使う場面を添える", () => {
    render(<IssueCiTokenForm />);
    expect(screen.getByRole("button", { name: "GitHub Actions 用の鍵を作る" })).toBeTruthy();
    expect(screen.getByText(/年に数回しか使いません/)).toBeTruthy();
    expect(screen.queryByLabelText("何に使うか")).toBeNull();
  });

  it("開くと、指示文を読めないことを作る前に言い切る", async () => {
    await open();
    expect(screen.getByText(/要望の状態を進めることだけです/)).toBeTruthy();
    expect(screen.getByText("指示文は読めません。")).toBeTruthy();
  });

  it("何に使うかを書くまで作れない", async () => {
    await open();
    const make = screen.getByRole("button", { name: "この内容で作る" });
    expect((make as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText("何に使うか"), "確認依頼のマージで対応済みにするため");
    expect((make as HTMLButtonElement).disabled).toBe(false);
  });

  it("送る中身は必ず ci で、範囲は空", async () => {
    const fetchMock = stubFetch({ json: { token: TOKEN, expiresAt: "2026-09-14T00:00:00.000Z" } });
    await open();
    await userEvent.type(screen.getByLabelText("何に使うか"), "確認依頼のマージで対応済みにするため");
    await userEvent.click(screen.getByRole("button", { name: "この内容で作る" }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    // 画面の状態から組み立てず、何を作るかを言い切って送る
    expect(body.purpose).toBe("ci");
    expect(body.ids).toEqual([]);
    expect(body.reason).toContain("確認依頼");
  });

  it("作れたら、鍵と置き場所が1回だけ出る", async () => {
    stubFetch({ json: { token: TOKEN, expiresAt: "2026-09-14T00:00:00.000Z" } });
    await open();
    await userEvent.type(screen.getByLabelText("何に使うか"), "確認依頼のマージで対応済みにするため");
    await userEvent.click(screen.getByRole("button", { name: "この内容で作る" }));

    const box = await screen.findByLabelText("GitHub の保管庫に入れる鍵");
    expect((box as HTMLTextAreaElement).value).toBe(TOKEN);
    // どこに入れるかまで書く。名前が違うと workflow は静かに失敗する
    expect(screen.getByText("IMPROVEMENT_STATUS_TOKEN")).toBeTruthy();
    expect(screen.getByText(/もう一度は出せません/)).toBeTruthy();
  });

  it("断られたら理由を出し、鍵は出さない", async () => {
    stubFetch({ ok: false, json: { message: "何に使うかを書いてください。" } });
    await open();
    await userEvent.type(screen.getByLabelText("何に使うか"), "確認依頼のマージで対応済みにするため");
    await userEvent.click(screen.getByRole("button", { name: "この内容で作る" }));

    expect(await screen.findByText("何に使うかを書いてください。")).toBeTruthy();
    expect(screen.queryByLabelText("GitHub の保管庫に入れる鍵")).toBeNull();
  });
});
