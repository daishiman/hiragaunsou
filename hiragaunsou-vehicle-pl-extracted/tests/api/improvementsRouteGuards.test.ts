import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "../../src/infrastructure/security/rateLimit";

/**
 * /api/improvements (改善要望) の防御ロジックを検証する。
 *  1. 権限ガード (投稿は業務画面を開ける人なら誰でも / 読むのは管理者だけ)
 *  2. CSRF対策 (POST・PATCH は Origin を見る)
 *  3. 入力検証 (パス・送信キー・本文・画像の中身)
 *  4. 再送の扱い (同じ送信キーで2件にならない)
 *  5. 見送りの理由必須 (ドメインのルールが API でも効いていること)
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

/** 1×1 の本物の PNG。中身の先頭バイトまで見る検査を通すために使う。 */
const PNG_1PX =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const KEY = "11111111-1111-1111-1111-111111111111";

const { sessionMock, saveMock, findBySubmissionKeyMock, listAllMock, findByIdMock, updateHandlingMock } =
  vi.hoisted(() => ({
    sessionMock: vi.fn(),
    saveMock: vi.fn(async () => "improve_abc"),
    findBySubmissionKeyMock: vi.fn(async () => null as string | null),
    listAllMock: vi.fn(async () => []),
    findByIdMock: vi.fn(async () => null as unknown),
    updateHandlingMock: vi.fn(async () => {}),
  }));

vi.mock("../../src/infrastructure/auth/session", () => ({
  getServerSession: sessionMock,
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({
    env: { DB: {}, BETTER_AUTH_URL: ORIGIN },
  })),
}));

vi.mock("../../src/infrastructure/db/client", () => ({
  createDb: vi.fn(() => ({})),
}));

class D1ImprovementRepositoryMock {
  save = saveMock;
  findBySubmissionKey = findBySubmissionKeyMock;
  listAll = listAllMock;
  findById = findByIdMock;
  updateHandling = updateHandlingMock;
}
vi.mock("../../src/infrastructure/db/D1ImprovementRepository", () => ({
  D1ImprovementRepository: D1ImprovementRepositoryMock,
}));

const adminSession = { id: "admin-1", email: "admin@example.co.jp", name: "管理者", role: "admin" as const };
const staffSession = {
  id: "staff-1",
  email: "staff@example.co.jp",
  name: "入力担当",
  role: "input_staff" as const,
};

function post(body: unknown, origin = ORIGIN): Request {
  return new Request("http://test/api/improvements", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validPost = {
  path: "/vehicle/1177?ym=2026-05",
  body: "この画面の合計が右端で切れて読めません。",
  viewport: "1440×900",
  submissionKey: KEY,
};

describe("/api/improvements の投稿", () => {
  beforeEach(() => {
    sessionMock.mockReset();
    saveMock.mockClear();
    findBySubmissionKeyMock.mockReset();
    findBySubmissionKeyMock.mockResolvedValue(null);
    resetRateLimits();
  });

  it("ログインしていなければ401", async () => {
    sessionMock.mockResolvedValue(null);
    const { POST } = await import("../../app/api/improvements/route");
    expect((await POST(post(validPost))).status).toBe(401);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("入力担当でも送れる (一番不便をしている人の声を塞がない)", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    expect((await POST(post(validPost))).status).toBe(200);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("Originが一致しなければ403 (CSRF対策)", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    expect((await POST(post(validPost, "https://evil.example.com"))).status).toBe(403);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("保存するのはクエリを落とした実URLと、集計用の画面パターン", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    await POST(post(validPost));
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/vehicle/1177",
        routePattern: "/vehicle/[vehicleNo]",
        screenLabel: "車両1台の明細",
      }),
    );
  });

  it("投稿者は必ずセッションから決める (名乗りは受け付けない)", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    await POST(post({ ...validPost, reporterId: "admin-1", reporterName: "管理者" }));
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ reporterId: "staff-1", reporterName: "入力担当" }),
    );
  });

  it("診断情報が無くても受け取る (記録が取れないことで要望を落とさない)", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    const res = await POST(post(validPost));
    expect(res.status).toBe(200);
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ diagnostics: null }));
  });

  it("診断情報の「誰が・どの画面か」はサーバ側で入れ直す (名乗りを信じない)", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    await POST(
      post({
        ...validPost,
        diagnostics: {
          environment: { browser: "Chrome 141" },
          reporter: { id: "admin-1", name: "管理者", role: "admin", organization: "よその会社" },
          screen: { path: "/admin", routePattern: "/admin", label: "管理", sourceFile: "x" },
          occurredAt: { utc: "1999-01-01T00:00:00.000Z", jst: "1999-01-01 09:00:00 JST" },
        },
      }),
    );
    const saved = saveMock.mock.calls.at(-1)?.[0] as {
      diagnostics: {
        reporter: { id: string; role: string };
        screen: { routePattern: string; sourceFile: string };
        occurredAt: { utc: string };
        environment: { browser: string };
      };
    };
    expect(saved.diagnostics.reporter.id).toBe("staff-1");
    expect(saved.diagnostics.reporter.role).toBe("input_staff");
    expect(saved.diagnostics.screen.routePattern).toBe("/vehicle/[vehicleNo]");
    expect(saved.diagnostics.screen.sourceFile).toBe("app/(app)/vehicle/[vehicleNo]/page.tsx");
    expect(saved.diagnostics.occurredAt.utc).not.toContain("1999");
    // ブラウザにしか分からないものは、そのまま受け取る。
    expect(saved.diagnostics.environment.browser).toBe("Chrome 141");
  });

  it("診断情報に混ざった秘密は、保存する前に伏せる", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    await POST(
      post({
        ...validPost,
        diagnostics: {
          console: [{ level: "error", message: "password=harunoumi2026", at: "12:00" }],
          network: [{ method: "GET", url: "/api/x?token=abcdef123456" }],
        },
      }),
    );
    const dump = JSON.stringify(saveMock.mock.calls.at(-1)?.[0]);
    expect(dump).not.toContain("harunoumi2026");
    expect(dump).not.toContain("abcdef123456");
  });

  it("本文が空なら400 (画像だけの投稿は受けない)", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    const res = await POST(post({ ...validPost, body: "   " }));
    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("別サイトへ読み替えられるパスは400", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    expect((await POST(post({ ...validPost, path: "//evil.example.com" }))).status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("送信キーの形が違えば400", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    expect((await POST(post({ ...validPost, submissionKey: "abc" }))).status).toBe(400);
  });

  it("画像に見せかけた別の中身は400 (先頭バイトまで見る)", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    const res = await POST(post({ ...validPost, shot: "data:image/png;base64,aGVsbG8gd29ybGQh" }));
    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("本物の画像は本文と一緒に受け取る", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    expect((await POST(post({ ...validPost, shot: PNG_1PX }))).status).toBe(200);
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ shot: PNG_1PX, shotBytes: expect.any(Number) }),
    );
  });

  it("同じ送信キーの押し直しは2件にならない", async () => {
    sessionMock.mockResolvedValue(staffSession);
    findBySubmissionKeyMock.mockResolvedValue("improve_abc");
    const { POST } = await import("../../app/api/improvements/route");
    const res = await POST(post(validPost));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "improve_abc", message: "この改善要望は送信済みです。" });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("連投は429で断り、何秒後なら送れるかを返す", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { POST } = await import("../../app/api/improvements/route");
    for (let i = 0; i < 5; i += 1) {
      await POST(post({ ...validPost, submissionKey: KEY.replace(/1$/, String(i)) }));
    }
    const res = await POST(post({ ...validPost, submissionKey: "22222222-2222-2222-2222-222222222222" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("保存に失敗しても中身を含む例外は外に出さない", async () => {
    sessionMock.mockResolvedValue(staffSession);
    saveMock.mockRejectedValueOnce(new Error(`D1_ERROR: near "${PNG_1PX}"`));
    const { POST } = await import("../../app/api/improvements/route");
    const res = await POST(post(validPost));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { message: string };
    expect(json.message).not.toContain("D1_ERROR");
  });
});

describe("/api/improvements の一覧", () => {
  beforeEach(() => {
    sessionMock.mockReset();
    listAllMock.mockClear();
  });

  it("管理者以外は401 (他の人が書いた不満を読ませない)", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { GET } = await import("../../app/api/improvements/route");
    expect((await GET()).status).toBe(401);
    expect(listAllMock).not.toHaveBeenCalled();
  });

  it("管理者は読める", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { GET } = await import("../../app/api/improvements/route");
    expect((await GET()).status).toBe(200);
    expect(listAllMock).toHaveBeenCalledTimes(1);
  });
});

describe("/api/improvements/[id] の対応状況の更新", () => {
  const current = {
    id: "improve_abc",
    status: "open" as const,
    handledNote: null as string | null,
  };

  beforeEach(() => {
    sessionMock.mockReset();
    findByIdMock.mockReset();
    findByIdMock.mockResolvedValue(current);
    updateHandlingMock.mockClear();
  });

  function patch(body: unknown, origin = ORIGIN): Request {
    return new Request("http://test/api/improvements/improve_abc", {
      method: "PATCH",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const params = Promise.resolve({ id: "improve_abc" });

  it("管理者以外は401", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { PATCH } = await import("../../app/api/improvements/[id]/route");
    expect((await PATCH(patch({ status: "doing" }), { params })).status).toBe(401);
    expect(updateHandlingMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403 (CSRF対策)", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { PATCH } = await import("../../app/api/improvements/[id]/route");
    const res = await PATCH(patch({ status: "doing" }, "https://evil.example.com"), { params });
    expect(res.status).toBe(403);
    expect(updateHandlingMock).not.toHaveBeenCalled();
  });

  it("知らない状態は400", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { PATCH } = await import("../../app/api/improvements/[id]/route");
    expect((await PATCH(patch({ status: "archived" }), { params })).status).toBe(400);
  });

  it("対象が無ければ404", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findByIdMock.mockResolvedValue(null);
    const { PATCH } = await import("../../app/api/improvements/[id]/route");
    expect((await PATCH(patch({ status: "doing" }), { params })).status).toBe(404);
  });

  it("理由の無い見送りは400で断る", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { PATCH } = await import("../../app/api/improvements/[id]/route");
    const res = await PATCH(patch({ status: "dropped", note: "  " }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({
      message: "見送りにする理由を入力してください。",
    });
    expect(updateHandlingMock).not.toHaveBeenCalled();
  });

  it("理由を書けば見送りにできる", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { PATCH } = await import("../../app/api/improvements/[id]/route");
    const res = await PATCH(patch({ status: "dropped", note: "別の画面で直したため" }), { params });
    expect(res.status).toBe(200);
    expect(updateHandlingMock).toHaveBeenCalledWith("improve_abc", {
      status: "dropped",
      note: "別の画面で直したため",
      handledById: "admin-1",
    });
  });

  it("同じ状態のまま対応メモを消せる", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findByIdMock.mockResolvedValue({ ...current, status: "doing", handledNote: "来週直す" });
    const { PATCH } = await import("../../app/api/improvements/[id]/route");
    const res = await PATCH(patch({ status: "doing", note: "" }), { params });
    expect(res.status).toBe(200);
    expect(updateHandlingMock).toHaveBeenCalledWith(
      "improve_abc",
      expect.objectContaining({ note: null }),
    );
  });

  it("何も変わらない保存は400で断る", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findByIdMock.mockResolvedValue({ ...current, status: "doing", handledNote: "来週直す" });
    const { PATCH } = await import("../../app/api/improvements/[id]/route");
    const res = await PATCH(patch({ status: "doing", note: "来週直す" }), { params });
    expect(res.status).toBe(400);
    expect(updateHandlingMock).not.toHaveBeenCalled();
  });

  it("対応済みからでも未対応へ戻せる", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findByIdMock.mockResolvedValue({ ...current, status: "done", handledNote: "直した" });
    const { PATCH } = await import("../../app/api/improvements/[id]/route");
    const res = await PATCH(patch({ status: "open", note: "直った気がしない" }), { params });
    expect(res.status).toBe(200);
  });
});
