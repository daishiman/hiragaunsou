import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * /api/auth/[...all] は Better Auth の全ルートを受け渡す薄いラッパー。
 * 検証対象は「リクエスト単位で env から createAuth し、auth.handler(request) の戻り値を
 * そのまま返す」という配線のみ (認証ロジック自体は Better Auth 側の責務)。
 * モジュールスコープに Auth インスタンスを固定しないことが要件なので、
 * 呼び出しごとに createAuth が走ることも確認する。
 */
const env = {
  DB: {},
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "https://example.test",
  WORKSPACE_DOMAINS: "example.co.jp",
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csecret",
};

const { getCloudflareContextMock, createAuthMock, handlerMock } = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
  createAuthMock: vi.fn(),
  handlerMock: vi.fn(),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock("../../src/infrastructure/auth/auth", () => ({
  createAuth: createAuthMock,
}));

describe("/api/auth/[...all] のハンドラ配線", () => {
  beforeEach(() => {
    getCloudflareContextMock.mockReset();
    getCloudflareContextMock.mockResolvedValue({ env });
    createAuthMock.mockReset();
    createAuthMock.mockImplementation(() => ({ handler: handlerMock }));
    handlerMock.mockReset();
  });

  it("GET は Cloudflare の env で createAuth し、auth.handler の応答をそのまま返す", async () => {
    const expected = new Response("session", { status: 200 });
    handlerMock.mockResolvedValue(expected);

    const { GET } = await import("../../app/api/auth/[...all]/route");
    const request = new Request("http://test/api/auth/get-session");
    const res = await GET(request);

    expect(createAuthMock).toHaveBeenCalledWith(env);
    expect(handlerMock).toHaveBeenCalledWith(request);
    expect(res).toBe(expected);
  });

  it("POST も同じハンドラで、リクエストを改変せず Better Auth に委譲する", async () => {
    const expected = new Response(null, { status: 302 });
    handlerMock.mockResolvedValue(expected);

    const { POST } = await import("../../app/api/auth/[...all]/route");
    const request = new Request("http://test/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google" }),
    });
    const res = await POST(request);

    expect(handlerMock).toHaveBeenCalledWith(request);
    expect(res).toBe(expected);
  });

  it("GET と POST は同一のハンドラ関数を共有する", async () => {
    const route = await import("../../app/api/auth/[...all]/route");
    expect(route.GET).toBe(route.POST);
  });

  it("呼び出しごとに createAuth する (Auth インスタンスをモジュールスコープに固定しない)", async () => {
    handlerMock.mockResolvedValue(new Response(null, { status: 200 }));
    const { GET } = await import("../../app/api/auth/[...all]/route");

    await GET(new Request("http://test/api/auth/get-session"));
    await GET(new Request("http://test/api/auth/get-session"));

    expect(getCloudflareContextMock).toHaveBeenCalledTimes(2);
    expect(createAuthMock).toHaveBeenCalledTimes(2);
  });
});
