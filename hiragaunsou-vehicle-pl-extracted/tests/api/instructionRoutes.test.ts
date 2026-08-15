import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ログインなしで開く唯一の入口 (鍵で読む口) と、その鍵を配る口を検証する。
 *
 *  - /api/instructions            Claude Code がまとめて読む
 *  - /api/instructions/:id        1件だけ読む
 *  - /api/instructions/shot/:id   画面の写しを期限つきで配る
 *  - /api/improvements/tokens     鍵の発行・失効 (システム管理者だけ)
 *
 * ここで固定するのは4つ。
 *  1. 鍵が無い・切れている・失効した鍵では1件も読めない
 *  2. 鍵の範囲の外は読めない (鍵1本で全件が開かない)
 *  3. 画像は署名と期限が両方合ったときだけ配り、断る理由は言わない
 *  4. 平文の鍵が返るのは発行の応答1回だけで、管理者以外・他所からは発行できない
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";
const SECRET = "test-secret";

const {
  sessionMock,
  findManyByIdsMock,
  findShotMock,
  markFetchedMock,
  appendAuditMock,
  issueMock,
  listMock,
  findByHashMock,
  revokeMock,
  touchMock,
  envMock,
} = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  findManyByIdsMock: vi.fn(async () => [] as unknown[]),
  findShotMock: vi.fn(async () => null as string | null),
  markFetchedMock: vi.fn(async () => {}),
  appendAuditMock: vi.fn(async () => {}),
  issueMock: vi.fn(async () => {}),
  listMock: vi.fn(async () => [] as unknown[]),
  findByHashMock: vi.fn(async () => null as unknown),
  revokeMock: vi.fn(async () => true),
  touchMock: vi.fn(async () => {}),
  envMock: {
    DB: {},
    BETTER_AUTH_URL: "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev",
    BETTER_AUTH_SECRET: "test-secret",
  } as Record<string, unknown>,
}));

vi.mock("../../src/infrastructure/auth/session", () => ({ getServerSession: sessionMock }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({ env: envMock })),
}));
vi.mock("../../src/infrastructure/db/client", () => ({ createDb: vi.fn(() => ({})) }));

class RepoMock {
  findManyByIds = findManyByIdsMock;
  findShot = findShotMock;
  markFetched = markFetchedMock;
  appendAudit = appendAuditMock;
}
vi.mock("../../src/infrastructure/db/D1ImprovementRepository", () => ({
  D1ImprovementRepository: RepoMock,
}));

class TokenRepoMock {
  issue = issueMock;
  list = listMock;
  findByHash = findByHashMock;
  revoke = revokeMock;
  touch = touchMock;
  revokeForRequests = vi.fn(async () => []);
}
vi.mock("../../src/infrastructure/db/D1InstructionTokenRepository", () => ({
  D1InstructionTokenRepository: TokenRepoMock,
}));

import { hashAccessToken, signShotUrl } from "../../src/domain/rules/instructionAccess";
import { shotSecretOf } from "../../src/usecase/improvements/instructionDeps";

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

function tokenRecord(over: Record<string, unknown> = {}) {
  return {
    id: "tok_1",
    name: "2件を渡すための鍵",
    scopeIds: ["a", "b"],
    tokenHash: "hash",
    createdByName: "管理者",
    createdAt: new Date("2026-08-15T02:00:00.000Z"),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    revokedAt: null as Date | null,
    revokedReason: null as string | null,
    lastUsedAt: null as Date | null,
    useCount: 0,
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
    instruction: {
      version: 1,
      hash: "指紋",
      state: "published" as const,
      syncedFields: null,
      publishedAt: new Date("2026-08-15T02:00:00.000Z"),
      fetchedAt: null,
    },
    archivedAt: null as Date | null,
    duplicateOfId: null as string | null,
    createdAt: new Date("2026-08-15T01:00:00.000Z"),
    updatedAt: new Date("2026-08-15T01:00:00.000Z"),
    viewport: "1440×900",
    userAgent: "UA",
    shot: null as string | null,
    handledByName: null,
    handledAt: null,
    diagnostics: null,
    ...over,
  };
}

function read(path: string, token?: string): Request {
  return new Request(`http://test${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function listRoute() {
  return (await import("../../app/api/instructions/route")).GET;
}
async function oneRoute() {
  return (await import("../../app/api/instructions/[id]/route")).GET;
}
async function shotRoute() {
  return (await import("../../app/api/instructions/shot/[id]/route")).GET;
}
async function tokensRoute() {
  return await import("../../app/api/improvements/tokens/route");
}
async function tokenItemRoute() {
  return (await import("../../app/api/improvements/tokens/[id]/route")).DELETE;
}

beforeEach(() => {
  sessionMock.mockReset();
  findManyByIdsMock.mockReset();
  findManyByIdsMock.mockResolvedValue([]);
  findShotMock.mockReset();
  findShotMock.mockResolvedValue(null);
  markFetchedMock.mockClear();
  appendAuditMock.mockClear();
  issueMock.mockClear();
  listMock.mockReset();
  listMock.mockResolvedValue([]);
  findByHashMock.mockReset();
  findByHashMock.mockResolvedValue(null);
  revokeMock.mockClear();
  revokeMock.mockResolvedValue(true);
  touchMock.mockClear();
});

describe("/api/instructions（鍵で読む口）", () => {
  it("鍵が無ければ1件も読めない（要望のデータにも触らない）", async () => {
    const res = await (await listRoute())(read("/api/instructions"));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Authorization: Bearer");
    expect(findManyByIdsMock).not.toHaveBeenCalled();
  });

  it("知らない鍵は断る", async () => {
    const res = await (await listRoute())(read("/api/instructions", "hgcc_unknown"));
    expect(res.status).toBe(401);
    expect(findManyByIdsMock).not.toHaveBeenCalled();
  });

  it("失効した鍵・期限切れの鍵では読めない", async () => {
    findByHashMock.mockResolvedValue(tokenRecord({ revokedAt: new Date("2026-08-14T00:00:00.000Z") }));
    expect((await (await listRoute())(read("/api/instructions", "hgcc_x"))).status).toBe(401);

    findByHashMock.mockResolvedValue(tokenRecord({ expiresAt: new Date("2020-01-01T00:00:00.000Z") }));
    expect((await (await listRoute())(read("/api/instructions", "hgcc_x"))).status).toBe(401);
    expect(findManyByIdsMock).not.toHaveBeenCalled();
  });

  it("id を書かなければ、鍵の範囲だけを読む（範囲外は指定されても弾く）", async () => {
    findByHashMock.mockResolvedValue(tokenRecord());
    findManyByIdsMock.mockResolvedValue([row("a"), row("b")]);
    await (await listRoute())(read("/api/instructions", "hgcc_x"));
    expect(findManyByIdsMock).toHaveBeenCalledWith(["a", "b"]);

    findManyByIdsMock.mockClear();
    const res = await (await listRoute())(read("/api/instructions?id=z", "hgcc_x"));
    expect(findManyByIdsMock).toHaveBeenCalledWith([]);
    expect(await res.text()).toContain("この鍵では読めません");
  });

  it("全件を読める鍵で id を書かなければ、黙って全部返さずに指定を求める", async () => {
    findByHashMock.mockResolvedValue(tokenRecord({ scopeIds: [] }));
    const res = await (await listRoute())(read("/api/instructions", "hgcc_x"));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("?id=");
    expect(findManyByIdsMock).not.toHaveBeenCalled();
  });

  it("読めた件は Markdown で返し、どこにも溜めさせない", async () => {
    findByHashMock.mockResolvedValue(tokenRecord());
    findManyByIdsMock.mockResolvedValue([row("a"), row("b")]);
    const res = await (await listRoute())(read("/api/instructions", "hgcc_x"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("# 改善要望 2件（優先度の高い順）");
    expect(body).toContain("## 受け入れ条件");
    expect(markFetchedMock).toHaveBeenCalledWith(["a", "b"]);
    expect(touchMock).toHaveBeenCalledWith("tok_1");
  });

  it("渡せなかったものは黙って落とさず、末尾に理由を並べる", async () => {
    findByHashMock.mockResolvedValue(tokenRecord());
    findManyByIdsMock.mockResolvedValue([row("a")]);
    const body = await (await (await listRoute())(read("/api/instructions", "hgcc_x"))).text();
    expect(body).toContain("渡せなかったもの:");
    expect(body).toContain("- b:");
  });

  it("format=json では構造化データを返す（Markdown も添える）", async () => {
    findByHashMock.mockResolvedValue(tokenRecord());
    findManyByIdsMock.mockResolvedValue([row("a")]);
    const res = await (await listRoute())(read("/api/instructions?format=json", "hgcc_x"));
    const json = (await res.json()) as {
      items: { id: string; priority: string; acceptance: string[]; markdown: string }[];
      skipped: { id: string }[];
    };
    expect(json.items[0]?.id).toBe("a");
    expect(json.items[0]?.acceptance.length).toBeGreaterThan(0);
    expect(json.items[0]?.markdown).toContain("## 受け入れ条件");
    expect(json.skipped.map((s) => s.id)).toEqual(["b"]);
  });
});

describe("/api/instructions/[id]（1件だけ読む）", () => {
  it("鍵が無ければ読めない", async () => {
    const res = await (await oneRoute())(read("/api/instructions/a"), {
      params: Promise.resolve({ id: "a" }),
    });
    expect(res.status).toBe(401);
  });

  it("鍵の範囲の外は、あるともないとも言わずに断る", async () => {
    findByHashMock.mockResolvedValue(tokenRecord());
    const res = await (await oneRoute())(read("/api/instructions/z", "hgcc_x"), {
      params: Promise.resolve({ id: "z" }),
    });
    expect(res.status).toBe(404);
    expect(findManyByIdsMock).toHaveBeenCalledWith([]);
  });

  it("未発行の件は読めない", async () => {
    findByHashMock.mockResolvedValue(tokenRecord());
    findManyByIdsMock.mockResolvedValue([row("a", { instruction: null })]);
    const res = await (await oneRoute())(read("/api/instructions/a", "hgcc_x"), {
      params: Promise.resolve({ id: "a" }),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("発行されていません");
  });

  it("読める件は、一括と同じ本文を返す", async () => {
    findByHashMock.mockResolvedValue(tokenRecord());
    findManyByIdsMock.mockResolvedValue([row("a")]);
    const res = await (await oneRoute())(read("/api/instructions/a", "hgcc_x"), {
      params: Promise.resolve({ id: "a" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("## 受け入れ条件");
    expect(markFetchedMock).toHaveBeenCalledWith(["a"]);
  });
});

describe("/api/instructions/shot/[id]（画面の写し）", () => {
  async function signed(id: string, expiresAt: Date) {
    const { exp, sig } = await signShotUrl(id, expiresAt, shotSecretOf(envMock));
    return `/api/instructions/shot/${id}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
  }

  it("署名が無い・違う・期限切れは、すべて同じ 404（理由を教えない）", async () => {
    const cases = [
      "/api/instructions/shot/a",
      "/api/instructions/shot/a?exp=99999999999&sig=deadbeef",
      await signed("a", new Date(Date.now() - 1000)),
    ];
    for (const path of cases) {
      const res = await (await shotRoute())(new Request(`http://test${path}`), {
        params: Promise.resolve({ id: "a" }),
      });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    }
    expect(findShotMock).not.toHaveBeenCalled();
  });

  it("他の要望に出した署名を使い回せない", async () => {
    const path = await signed("a", new Date(Date.now() + 60_000));
    const res = await (await shotRoute())(
      new Request(`http://test${path.replace("/shot/a", "/shot/b")}`),
      { params: Promise.resolve({ id: "b" }) },
    );
    expect(res.status).toBe(404);
    expect(findShotMock).not.toHaveBeenCalled();
  });

  it("署名が正しくても画像が無ければ 404", async () => {
    const path = await signed("a", new Date(Date.now() + 60_000));
    const res = await (await shotRoute())(new Request(`http://test${path}`), {
      params: Promise.resolve({ id: "a" }),
    });
    expect(res.status).toBe(404);
    expect(findShotMock).toHaveBeenCalledWith("a");
  });

  it("署名と期限が合えば画像を返し、経路に残させない", async () => {
    findShotMock.mockResolvedValue(`data:image/png;base64,${btoa("PNGDATA")}`);
    const path = await signed("a", new Date(Date.now() + 60_000));
    const res = await (await shotRoute())(new Request(`http://test${path}`), {
      params: Promise.resolve({ id: "a" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("PNGDATA");
  });
});

describe("/api/improvements/tokens（鍵を配る）", () => {
  function post(body: unknown, origin = ORIGIN): Request {
    return new Request("http://test/api/improvements/tokens", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("管理者以外は鍵を作れない・一覧も見られない", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { GET, POST } = await tokensRoute();
    expect((await GET()).status).toBe(401);
    expect((await POST(post({ ids: ["a"] }))).status).toBe(401);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("ログインしていなければ作れない", async () => {
    sessionMock.mockResolvedValue(null);
    const { POST } = await tokensRoute();
    expect((await POST(post({ ids: ["a"] }))).status).toBe(401);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("他所からの操作は受け付けない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { POST } = await tokensRoute();
    const res = await POST(post({ ids: ["a"] }, "https://evil.example.com"));
    expect(res.status).toBe(403);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("上限を超える期間は断る（黙って縮めない）", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { POST } = await tokensRoute();
    const res = await POST(post({ ids: ["a"], days: 90 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("30日");
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("存在しない要望を範囲に入れた鍵は作らない（渡したのに読めない、を防ぐ）", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("a")]);
    const { POST } = await tokensRoute();
    const res = await POST(post({ ids: ["a", "missing"] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("1件");
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("作った鍵の平文はこの応答だけ。保存するのは指紋で、貼れる形まで返す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findManyByIdsMock.mockResolvedValue([row("a")]);
    const { POST } = await tokensRoute();
    const res = await POST(post({ ids: ["a"], name: "1件を渡すための鍵" }));
    const json = (await res.json()) as {
      token: string;
      masked: string;
      command: string;
      scopeIds: string[];
    };

    expect(json.token.startsWith("hgcc_")).toBe(true);
    expect(json.masked.length).toBeLessThan(json.token.length);
    expect(json.command).toContain(`${ORIGIN}/api/instructions`);
    expect(json.command).toContain(json.token);
    expect(json.scopeIds).toEqual(["a"]);

    // 保存側へ渡すのは指紋だけ
    const saved = issueMock.mock.calls[0]?.[0] as unknown as { tokenHash: string; scopeIds: string[] };
    expect(saved.tokenHash).toBe(await hashAccessToken(json.token));
    expect(JSON.stringify(saved)).not.toContain(json.token);
    expect(saved.scopeIds).toEqual(["a"]);

    // 鍵を作ったこと自体を、範囲に入れた要望の記録に残す
    const audit = appendAuditMock.mock.calls[0]?.[0] as unknown as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(["token_issue"]);
  });

  /**
   * 発行済みのすべてを読める鍵。
   *
   * 一番強い鍵なので、重みは画面ではなくここ (サーバ側) で掛ける。画面の作りだけで
   * 止めていると、API を直に叩けば理由なし・長い期限の全件鍵が作れてしまう。
   */
  describe("発行済みのすべてを読める鍵", () => {
    it("理由が短ければ作らない（後から「なぜ全件か」を辿れなくなる）", async () => {
      sessionMock.mockResolvedValue(adminSession);
      const { POST } = await tokensRoute();
      const res = await POST(post({ ids: [], reason: "確認", days: 1 }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toContain("5文字以上");
      expect(issueMock).not.toHaveBeenCalled();
    });

    it("期限が3日を超えるなら断る（黙って縮めない）", async () => {
      sessionMock.mockResolvedValue(adminSession);
      const { POST } = await tokensRoute();
      const res = await POST(post({ ids: [], reason: "まとめて棚卸しするため", days: 7 }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toContain("3日");
      expect(issueMock).not.toHaveBeenCalled();
    });

    it("期限を指定しなければ1日。範囲は空のまま作る", async () => {
      sessionMock.mockResolvedValue(adminSession);
      const { POST } = await tokensRoute();
      const res = await POST(post({ ids: [], reason: "まとめて棚卸しするため" }));
      expect(res.status).toBe(200);

      const saved = issueMock.mock.calls[0]?.[0] as unknown as {
        scopeIds: string[];
        expiresAt: Date;
      };
      expect(saved.scopeIds).toEqual([]);
      const hours = (saved.expiresAt.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23);
      expect(hours).toBeLessThanOrEqual(24);
    });

    it("紐づけ先の要望が無くても、作った記録は必ず1行残る", async () => {
      sessionMock.mockResolvedValue(adminSession);
      const { POST } = await tokensRoute();
      await POST(post({ ids: [], reason: "まとめて棚卸しするため", days: 2 }));

      const audit = appendAuditMock.mock.calls[0]?.[0] as unknown as {
        requestId: string;
        action: string;
        reason: string;
      }[];
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("token_issue");
      expect(audit[0]!.requestId).toBe("(全件を読める鍵)");
      // 書いた理由がそのまま記録に残る。
      expect(audit[0]!.reason).toContain("まとめて棚卸しするため");
    });
  });
});

describe("/api/improvements/tokens/[id]（鍵を止める）", () => {
  function del(id: string, body: unknown, origin = ORIGIN): Request {
    return new Request(`http://test/api/improvements/tokens/${id}`, {
      method: "DELETE",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("管理者以外・他所からは止められない", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const route = await tokenItemRoute();
    expect(
      (await route(del("tok_1", {}), { params: Promise.resolve({ id: "tok_1" }) })).status,
    ).toBe(401);

    sessionMock.mockResolvedValue(adminSession);
    expect(
      (
        await route(del("tok_1", {}, "https://evil.example.com"), {
          params: Promise.resolve({ id: "tok_1" }),
        })
      ).status,
    ).toBe(403);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("無い鍵は 404（存在しないものを止めたことにしない）", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const route = await tokenItemRoute();
    const res = await route(del("tok_x", {}), { params: Promise.resolve({ id: "tok_x" }) });
    expect(res.status).toBe(404);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("止めたら、理由と操作した人つきで記録に残す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    listMock.mockResolvedValue([tokenRecord()]);
    const route = await tokenItemRoute();
    const res = await route(del("tok_1", { reason: "渡す相手が変わったため" }), {
      params: Promise.resolve({ id: "tok_1" }),
    });
    expect(res.status).toBe(200);
    expect(revokeMock).toHaveBeenCalledWith("tok_1", "渡す相手が変わったため（管理者）");

    const audit = appendAuditMock.mock.calls[0]?.[0] as unknown as {
      requestId: string;
      action: string;
      reason: string;
    }[];
    expect(audit.map((a) => a.requestId)).toEqual(["a", "b"]);
    expect(audit[0]?.action).toBe("token_revoke");
    expect(audit[0]?.reason).toContain("渡す相手が変わったため");
  });

  it("二度押しても記録は増えない（すでに失効しているとだけ伝える）", async () => {
    sessionMock.mockResolvedValue(adminSession);
    listMock.mockResolvedValue([tokenRecord()]);
    revokeMock.mockResolvedValue(false);
    const route = await tokenItemRoute();
    const res = await route(del("tok_1", {}), { params: Promise.resolve({ id: "tok_1" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { message: string }).message).toContain("すでに失効");
    expect(appendAuditMock).not.toHaveBeenCalled();
  });
});

/** 署名の鍵は、ログインの鍵から用途名を混ぜて導く（設定を増やさない）。 */
describe("画像の署名に使う鍵", () => {
  it("ログインの鍵そのままではなく、用途名を混ぜたものを使う", () => {
    expect(shotSecretOf(envMock)).toBe(`${SECRET}:improvement-shot`);
    expect(shotSecretOf({})).toBe(":improvement-shot");
  });
});
