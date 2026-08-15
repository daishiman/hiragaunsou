import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/improvements/[id]/issue の防御と手順を検証する。
 *
 * ここで守るのは4つ。
 *  1. 起票は管理者の操作からしか動かない (利用者の投稿で自動起票しない)
 *  2. 起票せずに文面だけ見られる (何が外へ出るか確かめてから押せる)
 *  3. 同じ要望から Issue が2本立たない
 *  4. 起票先が未設定でも画面が壊れない
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const {
  sessionMock,
  findByIdMock,
  beginIssuingMock,
  releaseIssuingMock,
  markIssuedMock,
  envMock,
  fetchMock,
} = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  findByIdMock: vi.fn(),
  beginIssuingMock: vi.fn(async () => true),
  releaseIssuingMock: vi.fn(async () => {}),
  markIssuedMock: vi.fn(async () => true),
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
  beginIssuing = beginIssuingMock;
  releaseIssuing = releaseIssuingMock;
  markIssued = markIssuedMock;
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

const item = {
  id: "improve_abc",
  status: "open" as const,
  path: "/vehicle/1177",
  routePattern: "/vehicle/[vehicleNo]",
  screenLabel: "車両別の収支",
  body: "合計が切れて読めません。",
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
};

function post(body: unknown, origin = ORIGIN): Request {
  return new Request(`http://test/api/improvements/improve_abc/issue`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "improve_abc" });

async function route() {
  return (await import("../../app/api/improvements/[id]/issue/route")).POST;
}

describe("/api/improvements/[id]/issue", () => {
  beforeEach(() => {
    sessionMock.mockReset();
    findByIdMock.mockReset();
    findByIdMock.mockResolvedValue({ ...item });
    beginIssuingMock.mockClear();
    beginIssuingMock.mockResolvedValue(true);
    releaseIssuingMock.mockClear();
    markIssuedMock.mockClear();
    markIssuedMock.mockResolvedValue(true);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    envMock.GITHUB_ISSUE_TOKEN = "ghp_dummy_token_value";
    envMock.GITHUB_ISSUE_REPO = "daishiman/hiragaunsou";
  });

  it("ログインしていなければ401", async () => {
    sessionMock.mockResolvedValue(null);
    const res = await (await route())(post({}), { params });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("管理者以外は起票できない（利用者の操作で外へ出ない）", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const res = await (await route())(post({}), { params });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("他所からの操作は受け付けない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const res = await (await route())(post({}, "https://evil.example.com"), { params });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("見つからない要望は404", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findByIdMock.mockResolvedValue(null);
    const res = await (await route())(post({}), { params });
    expect(res.status).toBe(404);
  });

  it("下書きは、起票せずに文面をそのまま返す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const res = await (await route())(post({ dryRun: true }), { params });
    const json = (await res.json()) as { dryRun: boolean; body: string; labels: string[] };
    expect(res.status).toBe(200);
    expect(json.dryRun).toBe(true);
    expect(json.body).toContain("合計が切れて読めません。");
    expect(json.labels).toContain("改善要望");
    // 下書きでは GitHub へ一切触らない。
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beginIssuingMock).not.toHaveBeenCalled();
  });

  it("起票済みの要望は、押し直しても2本目を立てない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findByIdMock.mockResolvedValue({
      ...item,
      githubIssueNumber: 12,
      githubIssueUrl: "https://github.com/x/y/issues/12",
    });
    const res = await (await route())(post({}), { params });
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("起票の権利を取れなければ GitHub へ投げない（同時押しで2本立たない）", async () => {
    sessionMock.mockResolvedValue(adminSession);
    beginIssuingMock.mockResolvedValue(false);
    const res = await (await route())(post({}), { params });
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("起票先が未設定なら、押しても壊れず下書きだけ返す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    delete envMock.GITHUB_ISSUE_TOKEN;
    const res = await (await route())(post({}), { params });
    const json = (await res.json()) as { message: string; body: string };
    expect(res.status).toBe(503);
    expect(json.message).toContain("起票先の設定");
    expect(json.body).toContain("合計が切れて読めません。");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("起票できたら番号とURLを結び付ける", async () => {
    sessionMock.mockResolvedValue(adminSession);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ number: 21, html_url: "https://github.com/x/y/issues/21" }), {
        status: 201,
      }),
    );
    const res = await (await route())(post({}), { params });
    const json = (await res.json()) as { issueNumber: number; issueUrl: string };
    expect(res.status).toBe(200);
    expect(json.issueNumber).toBe(21);
    expect(markIssuedMock).toHaveBeenCalledWith("improve_abc", {
      issueNumber: 21,
      issueUrl: "https://github.com/x/y/issues/21",
      issuedById: "admin-1",
    });
  });

  it("GitHub が断ったら権利を返して、次を試せるようにする", async () => {
    sessionMock.mockResolvedValue(adminSession);
    fetchMock.mockResolvedValue(new Response("Bad credentials", { status: 401 }));
    const res = await (await route())(post({}), { params });
    const json = (await res.json()) as { message: string };
    expect(res.status).toBe(502);
    expect(releaseIssuingMock).toHaveBeenCalledWith("improve_abc");
    // GitHub の応答本文はそのまま出さない。
    expect(json.message).not.toContain("Bad credentials");
    expect(json.message).toContain("トークン");
  });

  it("トークンを画面へ返さない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const res = await (await route())(post({ dryRun: true }), { params });
    const text = await res.text();
    expect(text).not.toContain("ghp_dummy_token_value");
  });
});
