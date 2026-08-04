import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";

/**
 * POST /api/todo/[id]/resolve (要確認カードの判定 / 判定取り消し) のガードと分岐を検証する。
 * 未ログイン401は tests/api/routeAuthGuards.test.ts で網羅済み。
 * ここでは approve_anomaly 権限、CSRF(Origin検証)、action による repo 呼び分けを扱う。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const { sessionRef, resolveMock, reopenMock } = vi.hoisted(() => ({
  sessionRef: { current: null as SessionUser | null },
  resolveMock: vi.fn(),
  reopenMock: vi.fn(),
}));

vi.mock("../../src/infrastructure/auth/session", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({ env: { DB: {}, BETTER_AUTH_URL: ORIGIN } })),
}));

vi.mock("../../src/infrastructure/db/client", () => ({
  createDb: vi.fn(() => ({})),
}));

vi.mock("../../src/infrastructure/db/D1ReviewFlagRepository", () => ({
  D1ReviewFlagRepository: class {
    resolve = resolveMock;
    reopen = reopenMock;
  },
}));

async function postResolve(
  body: Record<string, unknown>,
  { id = "flag-1", origin = ORIGIN }: { id?: string; origin?: string | null } = {},
) {
  const { POST } = await import("../../app/api/todo/[id]/resolve/route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  return POST(
    new Request(`http://test/api/todo/${id}/resolve`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("POST /api/todo/[id]/resolve", () => {
  beforeEach(() => {
    sessionRef.current = {
      id: "user-1",
      email: "staff@example.co.jp",
      name: "山本",
      role: "input_staff",
    };
    resolveMock.mockReset();
    resolveMock.mockResolvedValue(undefined);
    reopenMock.mockReset();
    reopenMock.mockResolvedValue(undefined);
  });

  it("approve_anomaly 権限を持たない executive は401", async () => {
    sessionRef.current = {
      id: "user-2",
      email: "exec@example.co.jp",
      name: "社長",
      role: "executive",
    };
    const res = await postResolve({ action: "approved" });
    expect(res.status).toBe(401);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("Origin が一致しなければ403 (CSRF対策)", async () => {
    const res = await postResolve({ action: "approved" }, { origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("Origin ヘッダーが無い場合も403 (ブラウザ外からの状態変更を拒否)", async () => {
    const res = await postResolve({ action: "approved" }, { origin: null });
    expect(res.status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it.each(["corrected", "approved", "dismissed"] as const)(
    "action=%s は resolve をパスのidとログインユーザーidで呼ぶ",
    async (action) => {
      const res = await postResolve({ action, note: "現地確認済み" }, { id: "flag-42" });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(resolveMock).toHaveBeenCalledWith("flag-42", "user-1", action, "現地確認済み");
      expect(reopenMock).not.toHaveBeenCalled();
    },
  );

  it("note 省略時は null を渡す (undefined を素通ししない)", async () => {
    await postResolve({ action: "approved" });
    expect(resolveMock).toHaveBeenCalledWith("flag-1", "user-1", "approved", null);
  });

  it("note が空文字ならそのまま空文字を渡す(境界値)", async () => {
    await postResolve({ action: "dismissed", note: "" });
    expect(resolveMock).toHaveBeenCalledWith("flag-1", "user-1", "dismissed", "");
  });

  it("action=reopen は resolve ではなく reopen を呼ぶ (判定のUndo経路)", async () => {
    const res = await postResolve({ action: "reopen", note: "押し間違い" }, { id: "flag-9" });

    expect(res.status).toBe(200);
    expect(reopenMock).toHaveBeenCalledWith("flag-9");
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("resolvedBy はリクエストbodyではなくセッションのユーザーidを使う(なりすまし防止)", async () => {
    sessionRef.current = {
      id: "real-user",
      email: "admin@example.co.jp",
      name: "今西",
      role: "admin",
    };
    await postResolve({ action: "approved", resolvedBy: "spoofed-user" });
    expect(resolveMock).toHaveBeenCalledWith("flag-1", "real-user", "approved", null);
  });
});
