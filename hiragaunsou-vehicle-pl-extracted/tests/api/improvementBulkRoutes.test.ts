import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 一覧から選んでまとめて実行する3つの口を検証する。
 *
 *  - /api/improvements/instructions まとめて指示文を発行し、Claude Code に渡す
 *  - /api/improvements/lifecycle    見送り・誤作成・重複・廃棄・廃棄から戻す
 *  - /api/improvements/purge        完全に削除する (戻せない)
 *
 * ここで固定するのは、一括にしたことで抜けやすくなる守り。
 *  1. 一括でも権限と出どころを必ず確かめる (画面の絞り込みに頼らない)
 *  2. 1件に指示文は1つ・変わっていない件は何もしない (何度押しても増えない)
 *  3. 廃棄や見送りは、選ばれていても指示文にならない
 *  4. 完全削除は最上位の管理者だけ・件数の一致・記録が先・鍵も止める
 *
 * このアプリは平賀運送1社だけを扱い会社の表を持たない。よって「他社を触らせない」
 * という境界はデータの側に存在せず、境界は権限と同一オリジンで引く。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const {
  sessionMock,
  findByIdMock,
  findManyByIdsMock,
  beginPublishingMock,
  releasePublishingMock,
  markPublishedMock,
  withdrawInstructionMock,
  appendAuditMock,
  updateLifecycleMock,
  purgeMock,
  revokeForRequestsMock,
  envMock,
  fetchMock,
} = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  findByIdMock: vi.fn(),
  findManyByIdsMock: vi.fn(),
  beginPublishingMock: vi.fn(async () => true),
  releasePublishingMock: vi.fn(async () => {}),
  markPublishedMock: vi.fn(async () => true),
  withdrawInstructionMock: vi.fn(async () => {}),
  appendAuditMock: vi.fn(async () => {}),
  updateLifecycleMock: vi.fn(async () => {}),
  purgeMock: vi.fn(async () => {}),
  revokeForRequestsMock: vi.fn(async () => [] as string[]),
  envMock: {
    DB: {},
    BETTER_AUTH_URL: "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev",
    BETTER_AUTH_SECRET: "test-secret",
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
  beginPublishing = beginPublishingMock;
  releasePublishing = releasePublishingMock;
  markPublished = markPublishedMock;
  withdrawInstruction = withdrawInstructionMock;
  appendAudit = appendAuditMock;
  updateLifecycle = updateLifecycleMock;
  purge = purgeMock;
  findShot = vi.fn(async () => null);
}
vi.mock("../../src/infrastructure/db/D1ImprovementRepository", () => ({
  D1ImprovementRepository: RepoMock,
}));

class TokenRepoMock {
  revokeForRequests = revokeForRequestsMock;
  issue = vi.fn(async () => {});
  list = vi.fn(async () => []);
  findByHash = vi.fn(async () => null);
  revoke = vi.fn(async () => true);
  touch = vi.fn(async () => {});
}
vi.mock("../../src/infrastructure/db/D1InstructionTokenRepository", () => ({
  D1InstructionTokenRepository: TokenRepoMock,
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

/** 発行済みの指示文。テストから見て「いま読める状態」を作るための形。 */
function instruction(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    hash: "指紋",
    state: "published" as const,
    syncedFields: null,
    publishedAt: new Date("2026-08-15T02:00:00.000Z"),
    fetchedAt: null,
    ...over,
  };
}

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
    createdAt: new Date("2026-08-15T01:00:00.000Z"),
    viewport: "1440×900",
    userAgent: "UA",
    shot: null,
    handledByName: null,
    handledAt: null,
    diagnostics: null,
    instruction: null as ReturnType<typeof instruction> | null,
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

async function instructionsRoute() {
  return (await import("../../app/api/improvements/instructions/route")).POST;
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
  beginPublishingMock.mockClear();
  beginPublishingMock.mockResolvedValue(true);
  releasePublishingMock.mockClear();
  markPublishedMock.mockClear();
  markPublishedMock.mockResolvedValue(true);
  withdrawInstructionMock.mockClear();
  appendAuditMock.mockClear();
  updateLifecycleMock.mockClear();
  purgeMock.mockClear();
  revokeForRequestsMock.mockClear();
  revokeForRequestsMock.mockResolvedValue([]);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("/api/improvements/instructions（まとめて Claude Code に渡す）", () => {
  it("管理者以外は一括でも発行できない", async () => {
    sessionMock.mockResolvedValue(staffSession);
    findManyByIdsMock.mockResolvedValue([row("a"), row("b")]);
    const res = await (await instructionsRoute())(
      post("/api/improvements/instructions", { ids: ["a", "b"] }),
    );
    expect(res.status).toBe(401);
    expect(findManyByIdsMock).not.toHaveBeenCalled();
    expect(markPublishedMock).not.toHaveBeenCalled();
  });

  it("他所からの操作は一括でも受け付けない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const res = await (await instructionsRoute())(
      post("/api/improvements/instructions", { ids: ["a"] }, "https://evil.example.com"),
    );
    expect(res.status).toBe(403);
    expect(markPublishedMock).not.toHaveBeenCalled();
  });

  it("上限を超えたら、黙って切り捨てずに断る", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const ids = Array.from({ length: 26 }, (_, i) => `id_${i}`);
    const res = await (await instructionsRoute())(post("/api/improvements/instructions", { ids }));
    const json = (await res.json()) as { message: string };
    expect(res.status).toBe(400);
    expect(json.message).toContain("25件");
    expect(markPublishedMock).not.toHaveBeenCalled();
  });

  it("廃棄済み・見送り・誤作成・重複は、選ばれていても指示文にならない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([
      row("arch", { archivedAt: new Date("2026-08-14T00:00:00.000Z") }),
      row("drop", { status: "dropped" }),
      row("inv", { status: "invalid" }),
      row("dup", { status: "duplicate" }),
    ]);
    const res = await (await instructionsRoute())(
      post("/api/improvements/instructions", { ids: ["arch", "drop", "inv", "dup"] }),
    );
    const json = (await res.json()) as {
      plan: { publish: number; excluded: number };
      results: { id: string; kind: string; message: string }[];
    };
    expect(res.status).toBe(200);
    expect(json.plan.publish).toBe(0);
    expect(json.plan.excluded).toBe(4);
    // 数だけ減らして黙るのではなく、行ごとに理由を出す。
    expect(json.results.every((r) => r.kind === "excluded")).toBe(true);
    expect(json.results[0]?.message).toContain("廃棄済み");
    expect(markPublishedMock).not.toHaveBeenCalled();
    expect(beginPublishingMock).not.toHaveBeenCalled();
  });

  it("同じ内容で2回押しても、指示文は2つにならず版も上がらない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    // 1回目: 新しく発行する。このとき保存された指紋を2回目の状態に使う。
    findManyByIdsMock.mockResolvedValue([row("same")]);
    const first = await (await instructionsRoute())(
      post("/api/improvements/instructions", { ids: ["same"] }),
    );
    const firstJson = (await first.json()) as { plan: { publish: number } };
    expect(firstJson.plan.publish).toBe(1);
    const saved = markPublishedMock.mock.calls[0]?.[1] as
      | { hash: string; version: number }
      | undefined;
    expect(saved?.hash).toBeTruthy();
    expect(saved?.version).toBe(1);

    markPublishedMock.mockClear();
    beginPublishingMock.mockClear();
    findManyByIdsMock.mockResolvedValue([
      row("same", { instruction: instruction({ version: 1, hash: saved?.hash ?? "" }) }),
    ]);
    const res = await (await instructionsRoute())(
      post("/api/improvements/instructions", { ids: ["same"] }),
    );
    const json = (await res.json()) as {
      plan: { skip: number; revise: number };
      results: { kind: string; message: string }[];
    };
    expect(json.plan.skip).toBe(1);
    expect(json.plan.revise).toBe(0);
    expect(json.results[0]?.kind).toBe("skip");
    // 書き込みそのものが起きない (発行の権利すら取らない)。
    expect(beginPublishingMock).not.toHaveBeenCalled();
    expect(markPublishedMock).not.toHaveBeenCalled();
  });

  it("内容が変わっていれば版を上げて更新する", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([
      row("upd", { instruction: instruction({ version: 3, hash: "古い指紋" }) }),
    ]);
    const res = await (await instructionsRoute())(
      post("/api/improvements/instructions", { ids: ["upd"] }),
    );
    const json = (await res.json()) as { plan: { revise: number }; results: { ok: boolean }[] };
    expect(json.plan.revise).toBe(1);
    expect(json.results[0]?.ok).toBe(true);
    expect(markPublishedMock.mock.calls[0]?.[1]).toMatchObject({ version: 4 });
    // 更新も記録に残す (どの版で何が変わったかを後から追えるように)。
    const audits = appendAuditMock.mock.calls[0]?.[0] as { action: string }[];
    expect(audits[0]?.action).toBe("instruction_revise");
  });

  it("別の発行が動いている行は、その行だけ見送って権利を返す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("ok1"), row("busy2")]);
    beginPublishingMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await (await instructionsRoute())(
      post("/api/improvements/instructions", { ids: ["ok1", "busy2"] }),
    );
    const json = (await res.json()) as { results: { id: string; ok: boolean }[] };
    expect(res.status).toBe(200);
    expect(json.results.map((r) => [r.id, r.ok])).toEqual([
      ["ok1", true],
      ["busy2", false],
    ]);
    // 成功した1件目は確定している (全部やり直しにしない)。
    expect(markPublishedMock).toHaveBeenCalledTimes(1);
  });

  it("保存に失敗した行は権利を返して、その行だけ出し直せる", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("ng")]);
    markPublishedMock.mockResolvedValueOnce(false);
    const res = await (await instructionsRoute())(
      post("/api/improvements/instructions", { ids: ["ng"] }),
    );
    const json = (await res.json()) as { results: { ok: boolean }[] };
    expect(json.results[0]?.ok).toBe(false);
    expect(releasePublishingMock).toHaveBeenCalledWith("ng");
  });

  it("下書きなら、内訳と全文を見せるだけで何も保存しない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([
      row("new1"),
      row("upd1", { instruction: instruction({ version: 2, hash: "古い" }) }),
      row("arch1", { archivedAt: new Date("2026-08-14T00:00:00.000Z") }),
    ]);
    const res = await (await instructionsRoute())(
      post("/api/improvements/instructions", {
        ids: ["new1", "upd1", "arch1"],
        dryRun: true,
      }),
    );
    const json = (await res.json()) as {
      plan: { publish: number; revise: number; excluded: number };
      drafts: { id: string; markdown: string }[];
      results: unknown[];
    };
    expect(json.plan).toMatchObject({ publish: 1, revise: 1, excluded: 1 });
    expect(json.drafts).toHaveLength(3);
    // 押す前に、外へ出る中身をそのまま読めること。
    expect(json.drafts[0]?.markdown).toContain("受け入れ条件");
    expect(json.results).toEqual([]);
    expect(markPublishedMock).not.toHaveBeenCalled();
    expect(beginPublishingMock).not.toHaveBeenCalled();
  });
});

describe("/api/improvements/[id]/instruction（詳細画面から1件だけ渡す）", () => {
  async function singleRoute() {
    return (await import("../../app/api/improvements/[id]/instruction/route")).POST;
  }
  function call(id: string, body: unknown, origin = ORIGIN) {
    return singleRoute().then((post_) =>
      post_(post(`/api/improvements/${id}/instruction`, body, origin), {
        params: Promise.resolve({ id }),
      }),
    );
  }

  it("管理者以外は1件でも発行できない（要望を読みにも行かない）", async () => {
    sessionMock.mockResolvedValue(executiveSession);
    findManyByIdsMock.mockResolvedValue([row("a")]);
    const res = await call("a", {});
    expect(res.status).toBe(401);
    expect(findManyByIdsMock).not.toHaveBeenCalled();
  });

  it("ログインしていなければ401", async () => {
    sessionMock.mockResolvedValue(null);
    const res = await call("a", {});
    expect(res.status).toBe(401);
  });

  it("他所からの操作は受け付けない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const res = await call("a", {}, "https://evil.example.com");
    expect(res.status).toBe(403);
    expect(findManyByIdsMock).not.toHaveBeenCalled();
  });

  it("消えている・見つからない要望は404で、何も保存しない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([]);
    const res = await call("missing", {});
    const json = (await res.json()) as { message: string };
    expect(res.status).toBe(404);
    expect(json.message).toBe("対象の要望が見つかりませんでした。");
    expect(markPublishedMock).not.toHaveBeenCalled();
  });

  it("一括と同じ処理を件数1で呼ぶ（発行され、記録も残る）", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("one")]);
    const res = await call("one", {});
    const json = (await res.json()) as {
      plan: { publish: number };
      results: { id: string; ok: boolean }[];
    };
    expect(res.status).toBe(200);
    expect(findManyByIdsMock).toHaveBeenCalledWith(["one"]);
    expect(json.plan.publish).toBe(1);
    expect(json.results).toEqual([expect.objectContaining({ id: "one", ok: true })]);
    expect(markPublishedMock).toHaveBeenCalledTimes(1);
  });

  it("本文が壊れていても落ちず、本番の発行として扱う（下書き扱いにしない）", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("one")]);
    const broken = new Request("http://test/api/improvements/one/instruction", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: "{壊れている",
    });
    const res = await (await singleRoute())(broken, { params: Promise.resolve({ id: "one" }) });
    expect(res.status).toBe(200);
    expect(markPublishedMock).toHaveBeenCalledTimes(1);
  });

  it("下書きなら1件でも保存せず、外へ出る全文だけを返す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("one")]);
    const res = await call("one", { dryRun: true });
    const json = (await res.json()) as { drafts: { markdown: string }[]; results: unknown[] };
    expect(json.drafts).toHaveLength(1);
    expect(json.drafts[0]?.markdown).toContain("受け入れ条件");
    expect(json.results).toEqual([]);
    expect(markPublishedMock).not.toHaveBeenCalled();
  });

  it("廃棄済みは1件でも対象外として理由を返す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([
      row("arch", { archivedAt: new Date("2026-08-14T00:00:00.000Z") }),
    ]);
    const res = await call("arch", {});
    const json = (await res.json()) as { results: { kind: string; message: string }[] };
    expect(res.status).toBe(200);
    // 失敗ではなく「渡さないと決めた」件として、理由つきで返す。
    expect(json.results[0]?.kind).toBe("excluded");
    expect(json.results[0]?.message).toContain("廃棄済み");
    expect(markPublishedMock).not.toHaveBeenCalled();
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
    expect(json.results.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("直さないと決めた件は、発行済みの指示文も取り下げる", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("d", { instruction: instruction() })]);
    const res = await (await lifecycleRoute())(
      post("/api/improvements/lifecycle", {
        action: "drop",
        ids: ["d"],
        reason: "運用で回避できるため",
      }),
    );
    const json = (await res.json()) as {
      counts: { withdraw: number };
      results: { message: string }[];
    };
    expect(res.status).toBe(200);
    expect(json.counts.withdraw).toBe(1);
    expect(withdrawInstructionMock).toHaveBeenCalledWith("d");
    // 管理画面では見送りなのに Claude Code からは読める、という食い違いを残さない。
    expect(json.results[0]?.message).toContain("読めなくなります");
    const audits = appendAuditMock.mock.calls[0]?.[0] as { action: string }[];
    expect(audits.map((a) => a.action)).toContain("instruction_withdraw");
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
    expect(withdrawInstructionMock).not.toHaveBeenCalled();
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
    // 理由と操作した人が、記録だけを見て分かる形で残る (本体は消えるため)。
    expect(audits[0]?.reason).toContain("本人から削除の依頼があったため");
    expect(audits[0]?.reason).toContain("管理者");
    // 記録が先、削除が後。逆だと「消えているのに誰が消したか分からない」が起きる。
    expect(appendAuditMock.mock.invocationCallOrder[0]).toBeLessThan(
      purgeMock.mock.invocationCallOrder[0] as number,
    );
  });

  it("消した件を読める鍵は、消すより先に止める", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("a", { instruction: instruction() })]);
    revokeForRequestsMock.mockResolvedValue(["1件を渡すための鍵"]);
    const res = await (await purgeRoute())(
      post("/api/improvements/purge", { ids: ["a"], reason: "削除依頼", confirmCount: 1 }),
    );
    const json = (await res.json()) as { revokedTokens: string[] };
    expect(res.status).toBe(200);
    expect(revokeForRequestsMock).toHaveBeenCalledWith(["a"], expect.stringContaining("完全に削除"));
    expect(json.revokedTokens).toEqual(["1件を渡すための鍵"]);
    // 鍵が先、削除が後。逆にすると、消えた直後の一瞬だけ生きた鍵が残る。
    expect(revokeForRequestsMock.mock.invocationCallOrder[0]).toBeLessThan(
      purgeMock.mock.invocationCallOrder[0] as number,
    );
    // 何を止めたかも記録に残す。
    const actions = appendAuditMock.mock.calls
      .flatMap((c) => c[0] as { action: string }[])
      .map((a) => a.action);
    expect(actions).toContain("token_revoke");
  });

  it("下見では消さないし、鍵も止めない", async () => {
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
    expect(revokeForRequestsMock).not.toHaveBeenCalled();
  });
});
