import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeIssueFor,
  notePurgedIssue,
  syncIssues,
} from "../../src/usecase/improvements/syncIssues";
import { applyLifecycle } from "../../src/usecase/improvements/applyLifecycle";

/**
 * 起票と一生の管理を、通信の形ではなく「何が起きるか」で確かめる。
 *
 * ここでは GitHub の口をそのまま差し替えて、次の3つを固定する。
 *  1. 立ててある Issue は更新され、何が変わったかがコメントに残る
 *  2. GitHub 側で消えていた Issue は結び付きを外し、次に立て直せる状態に戻る
 *  3. 直さないと決めた要望の Issue は閉じ、完全削除では消さずに書き残す
 */

function detail(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: "open" as const,
    path: "/vehicle/1177",
    routePattern: "/vehicle/[vehicleNo]",
    screenLabel: "車両別の収支",
    body: `${id} の指摘`,
    reporterName: "入力担当",
    handledNote: null,
    hasShot: false,
    githubIssueNumber: null as number | null,
    createdAt: new Date("2026-08-15T01:00:00.000Z"),
    viewport: "1440×900",
    userAgent: "UA",
    shot: null,
    handledByName: null,
    handledAt: null,
    diagnostics: null,
    githubIssueUrl: null as string | null,
    githubIssuedAt: null,
    githubIssueState: null as string | null,
    githubSyncedAt: null as Date | null,
    githubContentHash: null as string | null,
    githubSyncedFields: null as string | null,
    archivedAt: null as Date | null,
    duplicateOfId: null as string | null,
    updatedAt: new Date("2026-08-15T01:00:00.000Z"),
    ...over,
  };
}

function repoMock(rows: ReturnType<typeof detail>[]) {
  return {
    findManyByIds: vi.fn(async (ids: string[]) => rows.filter((r) => ids.includes(r.id))),
    findById: vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    findShot: vi.fn(async () => "data:image/jpeg;base64,QUJD"),
    beginIssuing: vi.fn(async () => true),
    releaseIssuing: vi.fn(async () => {}),
    markIssued: vi.fn(async () => true),
    markIssueSynced: vi.fn(async () => {}),
    markIssueState: vi.fn(async () => {}),
    detachIssue: vi.fn(async () => {}),
    appendAudit: vi.fn(async () => {}),
    updateLifecycle: vi.fn(async () => {}),
    purge: vi.fn(async () => {}),
  };
}

function clientMock() {
  return {
    create: vi.fn(async () => ({ number: 100, url: "https://github.com/a/b/issues/100" })),
    update: vi.fn(async (n: number) => ({ number: n, url: `https://github.com/a/b/issues/${n}` })),
    comment: vi.fn(async () => true),
    close: vi.fn(async () => true),
    reopen: vi.fn(async () => true),
    state: vi.fn(async () => "open" as const),
    uploadShot: vi.fn(async () => "https://github.com/a/b/blob/HEAD/x.jpg?raw=1"),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function depsOf(repo: ReturnType<typeof repoMock>, client: ReturnType<typeof clientMock> | null) {
  return {
    repo: repo as any,
    client: client as any,
    attachShot: false,
    repoSlug: "a/b",
    appOrigin: "https://app.example.test",
    actorId: "admin-1",
    actorName: "管理者",
  };
}

describe("syncIssues（送る）", () => {
  let repo: ReturnType<typeof repoMock>;
  let client: ReturnType<typeof clientMock>;

  beforeEach(() => {
    repo = repoMock([]);
    client = clientMock();
  });

  it("立ててある Issue は本文を置き換え、何が変わったかをコメントに残す", async () => {
    const rows = [
      detail("a", {
        githubIssueNumber: 7,
        githubIssueState: "open",
        githubContentHash: "古い指紋",
        githubSyncedFields: JSON.stringify({
          status: "open",
          handledNote: null,
          screenLabel: "車両別の収支",
          archived: false,
        }),
        status: "doing",
      }),
    ];
    repo = repoMock(rows);
    const report = await syncIssues(["a"], depsOf(repo, client), { dryRun: false });

    expect(report.results[0]?.ok).toBe(true);
    expect(client.create).not.toHaveBeenCalled();
    expect(client.update).toHaveBeenCalledWith(7, expect.objectContaining({ title: expect.any(String) }));
    // 本文の置き換えとコメントは両方やる。片方だけだと最新か履歴のどちらかが消える。
    expect(String(client.comment.mock.calls[0]?.[1])).toContain("対応中");
    expect(repo.markIssueSynced).toHaveBeenCalled();
  });

  it("閉じている Issue は、頼まれたときだけ開き直す", async () => {
    const row = detail("a", {
      githubIssueNumber: 7,
      githubIssueState: "closed",
      githubContentHash: "古い指紋",
    });
    repo = repoMock([row]);
    const kept = await syncIssues(["a"], depsOf(repo, client), { dryRun: false });
    expect(client.reopen).not.toHaveBeenCalled();
    expect(kept.results[0]?.message).toContain("閉じたまま");

    repo = repoMock([row]);
    client = clientMock();
    const reopened = await syncIssues(["a"], depsOf(repo, client), {
      dryRun: false,
      reopenClosed: true,
    });
    expect(client.reopen).toHaveBeenCalledWith(7);
    expect(reopened.results[0]?.ok).toBe(true);
  });

  it("GitHub 側で消えていたら結び付きを外し、次に立て直せるようにする", async () => {
    repo = repoMock([
      detail("a", { githubIssueNumber: 7, githubIssueState: "open", githubContentHash: "古い" }),
    ]);
    client.update = vi.fn(async () => null);
    const report = await syncIssues(["a"], depsOf(repo, client), { dryRun: false });
    expect(repo.detachIssue).toHaveBeenCalledWith("a");
    expect(report.results[0]?.ok).toBe(false);
    expect(report.results[0]?.message).toContain("立て直します");
  });

  it("見つからない番号を握ったまま立て直すときは、先に結び付きを外す", async () => {
    repo = repoMock([detail("a", { githubIssueNumber: 7, githubIssueState: "missing" })]);
    const report = await syncIssues(["a"], depsOf(repo, client), { dryRun: false });
    expect(repo.detachIssue).toHaveBeenCalledWith("a");
    expect(client.create).toHaveBeenCalled();
    expect(report.results[0]?.ok).toBe(true);
  });

  it("画像を貼る設定のときだけ、起票の直前に1枚置く", async () => {
    repo = repoMock([detail("a", { hasShot: true })]);
    await syncIssues(["a"], { ...depsOf(repo, client), attachShot: true }, { dryRun: false });
    expect(repo.findShot).toHaveBeenCalledWith("a");
    expect(client.uploadShot).toHaveBeenCalled();
    // 置いたあとの本文で指紋を取り直す（次に押したとき空更新にならないように）。
    expect(repo.markIssued.mock.calls[0]?.[1]).toMatchObject({ contentHash: expect.any(String) });
  });

  it("立ったのに結び付けられなかったら、番号を握り潰さずに画面へ返す", async () => {
    repo = repoMock([detail("a")]);
    repo.markIssued = vi.fn(async () => false);
    const report = await syncIssues(["a"], depsOf(repo, client), { dryRun: false });
    expect(report.results[0]?.ok).toBe(false);
    expect(report.results[0]?.issueNumber).toBe(100);
    expect(report.results[0]?.message).toContain("結び付けに失敗");
  });

  it("起票先が未設定なら、下書きだけ返して失敗として残す", async () => {
    repo = repoMock([detail("a")]);
    const report = await syncIssues(["a"], depsOf(repo, null), { dryRun: false });
    expect(report.configured).toBe(false);
    expect(report.results[0]?.ok).toBe(false);
    expect(report.drafts[0]?.body).toContain("a の指摘");
  });
});

describe("closeIssueFor / notePurgedIssue（外へ書き残す）", () => {
  it("起票先が未設定なら、閉じずにその旨を返す", async () => {
    const res = await closeIssueFor(
      { issueNumber: 3, status: "dropped", archived: false, reason: null, parentIssueNumber: null },
      { client: null, actorName: "管理者" },
    );
    expect(res.closed).toBe(false);
    expect(res.message).toContain("未設定");
  });

  it("閉じられなかったことを、成功に見せない", async () => {
    const client = clientMock();
    client.close = vi.fn(async () => false);
    const res = await closeIssueFor(
      { issueNumber: 3, status: "dropped", archived: false, reason: "運用で回避", parentIssueNumber: null },
      { client: client as never, actorName: "管理者" },
    );
    expect(res.closed).toBe(false);
    expect(res.message).toContain("GitHub側で閉じてください");
  });

  it("通信ごと落ちても、状態の変更まで巻き戻さない", async () => {
    const client = clientMock();
    client.comment = vi.fn(async () => {
      throw new Error("offline");
    });
    const res = await closeIssueFor(
      { issueNumber: 3, status: "invalid", archived: false, reason: null, parentIssueNumber: null },
      { client: client as never, actorName: "管理者" },
    );
    expect(res.closed).toBe(false);
  });

  it("完全削除では Issue を消さず、元データが無いことを書いて閉じる", async () => {
    const client = clientMock();
    await notePurgedIssue(9, "本人からの依頼", { client: client as never, actorName: "管理者" });
    expect(String(client.comment.mock.calls[0]?.[1])).toContain("完全に削除されました");
    expect(client.close).toHaveBeenCalledWith(9);
  });

  it("起票先が未設定なら、書き残しは諦めて削除は進める", async () => {
    await expect(
      notePurgedIssue(9, null, { client: null, actorName: "管理者" }),
    ).resolves.toBeUndefined();
  });
});

describe("applyLifecycle（状態を変える・消す）", () => {
  it("重複にすると、まとめ先の Issue 番号をコメントへ載せて閉じる", async () => {
    const child = detail("child", { githubIssueNumber: 11, githubIssueState: "open" });
    const parent = detail("parent", { githubIssueNumber: 4, githubIssueState: "open" });
    const repo = repoMock([child, parent]);
    const client = clientMock();
    const report = await applyLifecycle(
      {
        action: "duplicate",
        ids: ["child"],
        reason: "同じ話のため",
        duplicateOfId: "parent",
        dryRun: false,
      },
      { repo: repo as never, client: client as never, actorId: "admin-1", actorName: "管理者" },
    );
    expect(report.counts.closeIssue).toBe(1);
    expect(String(client.comment.mock.calls[0]?.[1])).toContain("まとめ先: #4");
    expect(client.close).toHaveBeenCalledWith(11);
    expect(repo.markIssueState).toHaveBeenCalledWith("child", "closed");
    expect(repo.updateLifecycle.mock.calls[0]?.[1]).toMatchObject({
      status: "duplicate",
      duplicateOfId: "parent",
    });
  });

  it("1行が失敗しても、他の行は確定する", async () => {
    const repo = repoMock([detail("a"), detail("b")]);
    repo.updateLifecycle = vi.fn(async (id: string) => {
      if (id === "a") throw new Error("この行だけ書き込めませんでした");
    }) as never;
    const report = await applyLifecycle(
      { action: "archive", ids: ["a", "b"], reason: null, duplicateOfId: null, dryRun: false },
      { repo: repo as never, client: null, actorId: "admin-1", actorName: "管理者" },
    );
    expect(report.results.map((r) => r.ok)).toEqual([false, true]);
    expect(report.results[0]?.message).toContain("書き込めませんでした");
  });

  it("見つからない件は数に出す（黙って減らさない）", async () => {
    const repo = repoMock([detail("a")]);
    const report = await applyLifecycle(
      { action: "archive", ids: ["a", "消えた"], reason: null, duplicateOfId: null, dryRun: false },
      { repo: repo as never, client: null, actorId: "admin-1", actorName: "管理者" },
    );
    expect(report.counts.missing).toBe(1);
    expect(report.summary).toContain("見つからない");
  });

  it("完全削除では、画面の写しがある件もまとめて消すと書いて実行する", async () => {
    const repo = repoMock([detail("a", { hasShot: true })]);
    const report = await applyLifecycle(
      { action: "purge", ids: ["a"], reason: "削除依頼", duplicateOfId: null, dryRun: true },
      { repo: repo as never, client: null, actorId: "admin-1", actorName: "管理者" },
    );
    expect(report.items[0]?.note).toContain("画面の写し");
    expect(report.items[0]?.note).toContain("戻せません");
    expect(repo.purge).not.toHaveBeenCalled();
  });
});
