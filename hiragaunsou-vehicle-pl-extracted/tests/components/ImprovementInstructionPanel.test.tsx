/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImprovementInstructionPanel } from "../../app/(app)/admin/improvements/[id]/ImprovementInstructionPanel";

/**
 * 1件を Claude Code に渡すパネル。
 *
 * ここで固定するのは、外へ出るものを扱う画面の壊れ方。
 *  1. 確認する前に発行できない (中身を読まずに外へ出せない)
 *  2. 確認では、外へ出る全文がそのまま出る
 *  3. 鍵の入った文が出るのは発行のあと1回だけで、確認の段階では出ない
 *  4. 発行に失敗したら、鍵の入った文は出さない
 */

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const DRAFT = {
  id: "improve_1",
  title: "改善要望 improve_1",
  markdown: "# 合計が右端で切れています\n\n画面: /vehicle/1177",
};
const COMMAND = "curl -H 'authorization: Bearer hgcc_secret123' https://example.test/api/instructions";

/** 呼ばれた URL ごとに応答を差し替える fetch の代役。 */
function stubFetch(map: Record<string, { ok?: boolean; json: unknown }>) {
  const fetchMock = vi.fn(async (url: string) => {
    const hit = Object.entries(map).find(([key]) => url.includes(key));
    const res = hit?.[1] ?? { json: {} };
    return {
      ok: res.ok ?? true,
      json: async () => res.json,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel() {
  render(<ImprovementInstructionPanel id="improve_1" stateLabel="未発行" note="まだ渡していません" />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ImprovementInstructionPanel", () => {
  it("開いた時点では、確認のボタンしか出ない", () => {
    stubFetch({});
    renderPanel();
    expect(screen.getByRole("button", { name: "渡す文を確認する" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /発行/ })).toBeNull();
    expect(screen.queryByLabelText("開発者に渡す案内")).toBeNull();
  });

  it("確認すると、何が起きるかと外へ出る全文が出る（まだ鍵は出ない）", async () => {
    stubFetch({
      "/instruction": {
        json: { plan: { items: [{ reason: "1件を新しく発行します。" }] }, drafts: [DRAFT] },
      },
    });
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "渡す文を確認する" }));

    await waitFor(() => expect(screen.getByText("1件を新しく発行します。")).toBeTruthy());
    // 要約ではなく全文。載ってはいけないものは、全文でしか気づけない。
    expect(screen.getByText(/合計が右端で切れています/)).toBeTruthy();
    expect(screen.getByText(/\/vehicle\/1177/)).toBeTruthy();
    // 鍵はまだどこにも無い。
    expect(screen.queryByLabelText("開発者に渡す案内")).toBeNull();
  });

  it("確認した内容で発行すると、鍵の入った文が1回だけ出て、下書きは片付く", async () => {
    stubFetch({
      "/instruction": {
        json: {
          plan: { items: [{ reason: "1件を新しく発行します。" }] },
          drafts: [DRAFT],
          results: [{ ok: true, message: "1件を発行しました。" }],
        },
      },
      "/tokens": { json: { command: COMMAND, expiresAt: "2026-08-22T00:00:00.000Z" } },
    });
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "渡す文を確認する" }));
    await waitFor(() => screen.getByRole("button", { name: "この内容で発行して、渡す文を出す" }));
    await userEvent.click(screen.getByRole("button", { name: "この内容で発行して、渡す文を出す" }));

    const box = await screen.findByLabelText("開発者に渡す案内");
    expect((box as HTMLTextAreaElement).value).toBe(COMMAND);
    // 鍵が出ている箇所はこの1つだけ。画面のどこかに二重に残さない。
    const shown = screen.queryAllByText(COMMAND);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toBe(box);
    expect(screen.getByText(/この画面を離れるともう一度は出せません/)).toBeTruthy();
    // 出したあとに、もう一度同じ下書きから発行できる状態を残さない。
    expect(screen.queryByRole("button", { name: "この内容で発行して、渡す文を出す" })).toBeNull();
  });

  it("発行に失敗したら、理由を出して鍵の文は出さない", async () => {
    stubFetch({
      "/instruction": {
        json: {
          plan: { items: [{ reason: "1件を新しく発行します。" }] },
          drafts: [DRAFT],
          results: [{ ok: false, message: "いま別の発行が動いています。" }],
        },
      },
    });
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "渡す文を確認する" }));
    await waitFor(() => screen.getByRole("button", { name: "この内容で発行して、渡す文を出す" }));
    await userEvent.click(screen.getByRole("button", { name: "この内容で発行して、渡す文を出す" }));

    await waitFor(() => expect(screen.getByText("いま別の発行が動いています。")).toBeTruthy());
    expect(screen.queryByLabelText("開発者に渡す案内")).toBeNull();
  });

  it("通信できないときは、その旨を出して止まる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "渡す文を確認する" }));

    await waitFor(() =>
      expect(screen.getByText("通信できませんでした。時間をおいてお試しください。")).toBeTruthy(),
    );
  });
});
