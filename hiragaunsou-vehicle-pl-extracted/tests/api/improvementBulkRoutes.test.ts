import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 一覧から選んでまとめて実行する3つの口を検証する。
 *
 *  - /api/improvements/issues    まとめて Issue へ送る
 *  - /api/improvements/lifecycle 見送り・誤作成・重複・廃棄・廃棄から戻す
 *  - /api/improvements/purge     完全に削除する (戻せない)
 *
 * ここで固定するのは、一括にしたことで抜けやすくなる守り。
 *  1. 一括でも権限と出どころを必ず確かめる (画面の絞り込みに頼らない)
 *  2. 二重起票が起きない・変わっていない件は送らない
 *  3. 廃棄や見送りは、選ばれていても外へ出ない
 *  4. 完全削除は最上位の管理者だけ・件数の一致・記録が先
 *
 * このアプリは平賀運送1社だけを扱い会社の表を持たない。よって「他社を触らせない」
 * という境界はデータの側に存在せず、境界は権限と同一オリジンで引く。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const {
  sessionMock,
  findByIdMock,
  findManyByIdsMock,
  beginIssuingMock,
  releaseIssuingMock,
  markIssuedMock,
  markIssueSyncedMock,
  detachIssueMock,
  appendAuditMock,
  updateLifecycleMock,
  purgeMock,
  markIssueStateMock,
  envMock,
  fetchMock,
} = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  findByIdMock: vi.fn(),
  findManyByIdsMock: vi.fn(),
  beginIssuingMock: vi.fn(async () => true),
  releaseIssuingMock: vi.fn(async () => {}),
  markIssuedMock: vi.fn(async () => true),
  markIssueSyncedMock: vi.fn(async () => {}),
  detachIssueMock: vi.fn(async () => {}),
  appendAuditMock: vi.fn(async () => {}),
  updateLifecycleMock: vi.fn(async () => {}),
  purgeMock: vi.fn(async () => {}),
  markIssueStateMock: vi.fn(async () => {}),
  envMock: {
    DB: {},
    BETTER_AUTH_URL: "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev",
  } as Record<string, unknown>,
  fetchMock: vi.fn(),
}));

vi.mock("../../src/infrastructure/auth/session", () => ({ getServerSession: sessionMock }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({ env: envMock })),
}));
vi.mock("../../src/infrastructure/db/client", () => ({ createDb: vi.fn(() => ({})) }));

class RepoMock {
  findById = findByIdMock;
  findManyByIds = findManyByIdsMock;
  beginIssuing = beginIssuingMock;
  releaseIssuing = releaseIssuingMock;
  markIssued = markIssuedMock;
  markIssueSynced = markIssueSyncedMock;
  detachIssue = detachIssueMock;
  appendAudit = appendAuditMock;
  updateLifecycle = updateLifecycleMock;
  purge = purgeMock;
  markIssueState = markIssueStateMock;
  findShot = vi.fn(async () => null);
}
vi.mock("../../src/infrastructure/db/D1ImprovementRepository", () => ({
  D1ImprovementRepository: RepoMock,
}));

const adminSession = {
  id: "admin-1",
  email: "admin@example.co.jp",
  name: "管理者",
  role: "admin" as const,
};
const staffSession = {
  id: "staff-1",
  email: "staff@example.co.jp",
  name: "入力担当",
  role: "input_staff" as const,
};
const executiveSession = {
  id: "exec-1",
  email: "exec@example.co.jp",
  name: "役員",
  role: "executive" as const,
};

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    status: "open" as const,
    path: "/vehicle/1177",
    routePattern: "/vehicle/[vehicleNo]",
    screenLabel: "車両別の収支",
    body: `${id} の指摘です。`,
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

function post(path: string, body: unknown, origin = ORIGIN): Request {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function issuesRoute() {
  return (await import("../../app/api/improvements/issues/route")).POST;
}
async function lifecycleRoute() {
  return (await import("../../app/api/improvements/lifecycle/route")).POST;
}
async function purgeRoute() {
  return (await import("../../app/api/improvements/purge/route")).POST;
}

beforeEach(() => {
  sessionMock.mockReset();
  findByIdMock.mockReset();
  findByIdMock.mockResolvedValue(null);
  findManyByIdsMock.mockReset();
  beginIssuingMock.mockClear();
  beginIssuingMock.mockResolvedValue(true);
  releaseIssuingMock.mockClear();
  markIssuedMock.mockClear();
  markIssuedMock.mockResolvedValue(true);
  markIssueSyncedMock.mockClear();
  detachIssueMock.mockClear();
  appendAuditMock.mockClear();
  updateLifecycleMock.mockClear();
  purgeMock.mockClear();
  markIssueStateMock.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  envMock.GITHUB_ISSUE_TOKEN = "ghp_dummy_token_value";
  envMock.GITHUB_ISSUE_REPO = "daishiman/hiragaunsou";
});

describe("/api/improvements/issues（まとめて Issue へ送る）", () => {
  it("管理者以外は一括でも送れない", async () => {
    sessionMock.mockResolvedValue(staffSession);
    findManyByIdsMock.mockResolvedValue([row("a"), row("b")]);
    const res = await (await issuesRoute())(post("/api/improvements/issues", { ids: ["a", "b"] }));
    expect(res.status).toBe(401);
    expect(findManyByIdsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("他所からの操作は一括でも受け付けない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const res = await (await issuesRoute())(
      post("/api/improvements/issues", { ids: ["a"] }, "https://evil.example.com"),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("上限を超えたら、黙って切り捨てずに断る", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const ids = Array.from({ length: 26 }, (_, i) => `id_${i}`);
    const res = await (await issuesRoute())(post("/api/improvements/issues", { ids }));
    const json = (await res.json()) as { message: string };
    expect(res.status).toBe(400);
    expect(json.message).toContain("25件");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("廃棄済み・見送り・誤作成・重複は、選ばれていても外へ出ない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([
      row("arch", { archivedAt: new Date("2026-08-14T00:00:00.000Z") }),
      row("drop", { status: "dropped" }),
      row("inv", { status: "invalid" }),
      row("dup", { status: "duplicate" }),
    ]);
    const res = await (await issuesRoute())(
      post("/api/improvements/issues", { ids: ["arch", "drop", "inv", "dup"] }),
    );
    const json = (await res.json()) as {
      counts: { create: number; excluded: number };
      results: { id: string; kind: string; message: string }[];
    };
    expect(res.status).toBe(200);
    expect(json.counts.create).toBe(0);
    expect(json.counts.excluded).toBe(4);
    // 数だけ減らして黙るのではなく、行ごとに理由を出す。
    expect(json.results.every((r) => r.kind === "excluded")).toBe(true);
    expect(json.results[0]?.message).toContain("廃棄済み");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("起票済みの件は、一括でも2本目を立てない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([
      row("issued", {
        githubIssueNumber: 12,
        githubIssueUrl: "https://github.com/x/y/issues/12",
        githubIssueState: "open",
        githubContentHash: "ちがう指紋",
      }),
    ]);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ number: 12, html_url: "https://github.com/x/y/issues/12" }), {
        status: 200,
      }),
    );
    const res = await (await issuesRoute())(post("/api/improvements/issues", { ids: ["issued"] }));
    const json = (await res.json()) as { counts: { create: number; update: number } };
    expect(res.status).toBe(200);
    expect(json.counts.create).toBe(0);
    expect(json.counts.update).toBe(1);
    // 新規作成の口 (POST .../issues) は一度も叩かない。
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /\/issues$/.test(u))).toBe(false);
    expect(markIssuedMock).not.toHaveBeenCalled();
    expect(beginIssuingMock).not.toHaveBeenCalled();
  });

  it("内容が変わっていない件は、まとめて押しても送らない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    // 1回目: 新規で立てる。このとき保存された指紋を2回目の状態に使う。
    findManyByIdsMock.mockResolvedValue([row("same")]);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ number: 31, html_url: "https://github.com/x/y/issues/31" }), {
        status: 201,
      }),
    );
    await (await issuesRoute())(post("/api/improvements/issues", { ids: ["same"] }));
    const saved = markIssuedMock.mock.calls[0]?.[1] as { contentHash: string } | undefined;
    expect(saved?.contentHash).toBeTruthy();

    fetchMock.mockClear();
    findManyByIdsMock.mockResolvedValue([
      row("same", {
        githubIssueNumber: 31,
        githubIssueUrl: "https://github.com/x/y/issues/31",
        githubIssueState: "open",
        githubContentHash: saved?.contentHash ?? "",
      }),
    ]);
    const res = await (await issuesRoute())(post("/api/improvements/issues", { ids: ["same"] }));
    const json = (await res.json()) as {
      counts: { skip: number; update: number };
      results: { kind: string; message: string }[];
    };
    expect(json.counts.skip).toBe(1);
    expect(json.counts.update).toBe(0);
    expect(json.results[0]?.kind).toBe("skip");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("途中で失敗しても、成功した分は確定して行ごとに結果が出る", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("ok1"), row("ng2")]);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ number: 41, html_url: "https://github.com/x/y/issues/41" }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const res = await (await issuesRoute())(
      post("/api/improvements/issues", { ids: ["ok1", "ng2"] }),
    );
    const json = (await res.json()) as { results: { id: string; ok: boolean }[] };
    expect(res.status).toBe(200);
    expect(json.results.map((r) => [r.id, r.ok])).toEqual([
      ["ok1", true],
      ["ng2", false],
    ]);
    // 成功した1件目は確定している (全部やり直しにしない)。
    expect(markIssuedMock).toHaveBeenCalledTimes(1);
    // 失敗した2件目は権利を返して、その行だけ送り直せる状態にする。
    expect(releaseIssuingMock).toHaveBeenCalledWith("ng2");
  });

  it("下書きなら、何件が新規で何件が更新かを見せるだけで GitHub へ触らない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([
      row("new1"),
      row("upd1", { githubIssueNumber: 7, githubIssueState: "open", githubContentHash: "古い" }),
      row("arch1", { archivedAt: new Date("2026-08-14T00:00:00.000Z") }),
    ]);
    const res = await (await issuesRoute())(
      post("/api/improvements/issues", { ids: ["new1", "upd1", "arch1"], dryRun: true }),
    );
    const json = (await res.json()) as {
      counts: { create: number; update: number; excluded: number };
      drafts: { id: string; body: string }[];
    };
    expect(json.counts).toMatchObject({ create: 1, update: 1, excluded: 1 });
    expect(json.drafts).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/api/improvements/lifecycle（状態を変える・しまう・戻す）", () => {
  it("管理者以外は状態を変えられない", async () => {
    sessionMock.mockResolvedValue(executiveSession);
    const res = await (await lifecycleRoute())(
      post("/api/improvements/lifecycle", { action: "archive", ids: ["a"] }),
    );
    expect(res.status).toBe(401);
    expect(updateLifecycleMock).not.toHaveBeenCalled();
  });

  it("完全削除はこの口からは実行できない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const res = await (await lifecycleRoute())(
      post("/api/improvements/lifecycle", { action: "purge", ids: ["a"], reason: "依頼" }),
    );
    expect(res.status).toBe(400);
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("重複は、まとめ先を選ばないと実行できない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const res = await (await lifecycleRoute())(
      post("/api/improvements/lifecycle", { action: "duplicate", ids: ["a"], reason: "同じ話" }),
    );
    const json = (await res.json()) as { message: string };
    expect(res.status).toBe(400);
    expect(json.message).toContain("どの要望と重複しているか");
    expect(updateLifecycleMock).not.toHaveBeenCalled();
  });

  it("まとめて廃棄すると、行ごとに結果が返り記録が残る", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([
      row("a"),
      row("b", { archivedAt: new Date("2026-08-14T00:00:00.000Z") }),
    ]);
    const res = await (await lifecycleRoute())(
      post("/api/improvements/lifecycle", { action: "archive", ids: ["a", "b"] }),
    );
    const json = (await res.json()) as {
      counts: { apply: number; skip: number };
      results: { id: string; ok: boolean; message: string }[];
    };
    expect(res.status).toBe(200);
    // すでに廃棄済みの b は何も変わらないので実行しない。
    expect(json.counts).toMatchObject({ apply: 1, skip: 1 });
    expect(updateLifecycleMock).toHaveBeenCalledTimes(1);
    expect(updateLifecycleMock.mock.calls[0]?.[0]).toBe("a");
    expect(appendAuditMock).toHaveBeenCalledTimes(1);
    expect(json.results.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("廃棄から戻せる", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([
      row("a", { archivedAt: new Date("2026-08-14T00:00:00.000Z") }),
    ]);
    const res = await (await lifecycleRoute())(
      post("/api/improvements/lifecycle", { action: "restore", ids: ["a"] }),
    );
    const json = (await res.json()) as { counts: { apply: number } };
    expect(res.status).toBe(200);
    expect(json.counts.apply).toBe(1);
    expect(updateLifecycleMock.mock.calls[0]?.[1]).toMatchObject({ archivedAt: null });
  });

  it("下見では、何件に何が起きるかを出すだけで書き換えない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("a"), row("b")]);
    const res = await (await lifecycleRoute())(
      post("/api/improvements/lifecycle", {
        action: "drop",
        ids: ["a", "b"],
        reason: "運用で回避できるため",
        dryRun: true,
      }),
    );
    const json = (await res.json()) as { dryRun: boolean; summary: string; results: unknown[] };
    expect(json.dryRun).toBe(true);
    expect(json.summary).toContain("2件");
    expect(json.results).toEqual([]);
    expect(updateLifecycleMock).not.toHaveBeenCalled();
  });
});

describe("/api/improvements/purge（完全に削除する）", () => {
  it("管理者以外は完全削除できない", async () => {
    for (const session of [staffSession, executiveSession, null]) {
      sessionMock.mockResolvedValue(session);
      const res = await (await purgeRoute())(
        post("/api/improvements/purge", { ids: ["a"], reason: "依頼", confirmCount: 1 }),
      );
      expect(res.status).toBe(401);
    }
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("他所からの操作は受け付けない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const res = await (await purgeRoute())(
      post(
        "/api/improvements/purge",
        { ids: ["a"], reason: "依頼", confirmCount: 1 },
        "https://evil.example.com",
      ),
    );
    expect(res.status).toBe(403);
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("画面で見えていた件数と合わなければ実行しない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("a"), row("b")]);
    const res = await (await purgeRoute())(
      post("/api/improvements/purge", { ids: ["a", "b"], reason: "依頼", confirmCount: 3 }),
    );
    const json = (await res.json()) as { message: string };
    expect(res.status).toBe(400);
    expect(json.message).toContain("一致しません");
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("理由が無ければ実行しない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const res = await (await purgeRoute())(
      post("/api/improvements/purge", { ids: ["a"], reason: "   ", confirmCount: 1 }),
    );
    expect(res.status).toBe(400);
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it("消す前に記録を残し、そのあとで消す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("a"), row("b")]);
    const res = await (await purgeRoute())(
      post("/api/improvements/purge", {
        ids: ["a", "b"],
        reason: "本人から削除の依頼があったため",
        confirmCount: 2,
      }),
    );
    expect(res.status).toBe(200);
    expect(purgeMock).toHaveBeenCalledWith(["a", "b"]);
    const audits = appendAuditMock.mock.calls[0]?.[0] as {
      action: string;
      reason: string | null;
    }[];
    expect(audits.map((a) => a.action)).toEqual(["purge", "purge"]);
    expect(audits[0]?.reason).toBe("本人から削除の依頼があったため");
    // 記録が先、削除が後。逆だと「消えているのに誰が消したか分からない」が起きる。
    expect(appendAuditMock.mock.invocationCallOrder[0]).toBeLessThan(
      purgeMock.mock.invocationCallOrder[0] as number,
    );
  });

  it("すでに立っている Issue は消さず、元データが無いことを書き残す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([
      row("a", {
        githubIssueNumber: 55,
        githubIssueUrl: "https://github.com/x/y/issues/55",
        githubIssueState: "open",
      }),
    ]);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await (await purgeRoute())(
      post("/api/improvements/purge", { ids: ["a"], reason: "削除依頼", confirmCount: 1 }),
    );
    expect(res.status).toBe(200);
    const bodies = fetchMock.mock.calls.map((c) => String((c[1] as RequestInit).body ?? ""));
    expect(bodies.some((b) => b.includes("完全に削除されました"))).toBe(true);
    // Issue そのものを消す口 (DELETE) は叩かない。
    const methods = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).method);
    expect(methods).not.toContain("DELETE");
    expect(purgeMock).toHaveBeenCalledWith(["a"]);
  });

  it("下見では消さない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("a")]);
    const res = await (await purgeRoute())(
      post("/api/improvements/purge", { ids: ["a"], reason: "削除依頼", dryRun: true }),
    );
    const json = (await res.json()) as { dryRun: boolean; summary: string };
    expect(json.dryRun).toBe(true);
    expect(json.summary).toContain("完全に削除する");
    expect(purgeMock).not.toHaveBeenCalled();
    expect(appendAuditMock).not.toHaveBeenCalled();
  });
});
