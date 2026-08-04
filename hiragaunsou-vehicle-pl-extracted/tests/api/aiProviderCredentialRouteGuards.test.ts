import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * /api/ai-provider-credentials (AI連携APIキー管理, admin専用) の防御ロジックを検証する。
 *  1. 権限ガード(manage_api_keysを持たないロールは401)
 *  2. CSRF対策(POST/DELETEはOriginヘッダー検証)
 *  3. 入力検証(未知のprovider・カタログに無いmodelは拒否)
 *  4. レスポンスに平文APIキーを絶対に含めない
 * (UseCase自体のロジックは tests/usecase/manageAiProviderCredentials.test.ts で別途検証済み)
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";
const ENCRYPTION_SECRET = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="; // テスト専用ダミー鍵

const { sessionMock, upsertMock, removeMock, listMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  upsertMock: vi.fn(async () => {}),
  removeMock: vi.fn(async () => {}),
  listMock: vi.fn(async () => []),
}));

vi.mock("../../src/infrastructure/auth/session", () => ({
  getServerSession: sessionMock,
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({
    env: { DB: {}, BETTER_AUTH_URL: ORIGIN, API_KEY_ENCRYPTION_SECRET: ENCRYPTION_SECRET },
  })),
}));

vi.mock("../../src/infrastructure/db/client", () => ({
  createDb: vi.fn(() => ({})),
}));

class D1AiProviderCredentialRepositoryMock {
  list = listMock;
  upsert = upsertMock;
  remove = removeMock;
  findSecret = vi.fn(async () => null);
}
vi.mock("../../src/infrastructure/db/D1AiProviderCredentialRepository", () => ({
  D1AiProviderCredentialRepository: D1AiProviderCredentialRepositoryMock,
}));

const adminSession = { id: "admin-1", email: "admin@example.co.jp", name: "管理者", role: "admin" as const };
const executiveSession = { id: "exec-1", email: "exec@example.co.jp", name: "社長", role: "executive" as const };

describe("/api/ai-provider-credentials のガード", () => {
  beforeEach(() => {
    sessionMock.mockReset();
    upsertMock.mockClear();
    removeMock.mockClear();
    listMock.mockClear();
  });

  it("admin以外(executive)はGETでも401", async () => {
    sessionMock.mockResolvedValue(executiveSession);
    const { GET } = await import("../../app/api/ai-provider-credentials/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("Originが一致しなければPOSTは403(CSRF対策)", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { POST } = await import("../../app/api/ai-provider-credentials/route");
    const res = await POST(
      new Request("http://test/api/ai-provider-credentials", {
        method: "POST",
        headers: { origin: "https://evil.example.com", "content-type": "application/json" },
        body: JSON.stringify({ provider: "anthropic", apiKey: "sk-ant-xxx", model: "claude-sonnet-5" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければDELETEも403(CSRF対策)", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { DELETE } = await import("../../app/api/ai-provider-credentials/route");
    const res = await DELETE(
      new Request("http://test/api/ai-provider-credentials?provider=anthropic", {
        method: "DELETE",
        headers: { origin: "https://evil.example.com" },
      }),
    );
    expect(res.status).toBe(403);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("未知のproviderは400で拒否する", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { POST } = await import("../../app/api/ai-provider-credentials/route");
    const res = await POST(
      new Request("http://test/api/ai-provider-credentials", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ provider: "unknown-llm", apiKey: "sk-xxx", model: "some-model" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("カタログに無いmodelは400で拒否する", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { POST } = await import("../../app/api/ai-provider-credentials/route");
    const res = await POST(
      new Request("http://test/api/ai-provider-credentials", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          provider: "anthropic",
          apiKey: "sk-ant-xxx",
          model: "not-in-catalog",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("正常な保存はレスポンスに平文APIキーを含めない", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { POST } = await import("../../app/api/ai-provider-credentials/route");
    const plainKey = "sk-ant-super-secret-value";
    const res = await POST(
      new Request("http://test/api/ai-provider-credentials", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ provider: "anthropic", apiKey: plainKey, model: "claude-sonnet-5" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(plainKey);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const saved = upsertMock.mock.calls[0]?.[0] as { apiKeyCipher: string };
    expect(saved.apiKeyCipher).not.toContain(plainKey);
  });

  it("削除はprovider指定でrepo.removeを呼ぶ", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { DELETE } = await import("../../app/api/ai-provider-credentials/route");
    const res = await DELETE(
      new Request("http://test/api/ai-provider-credentials?provider=openai", {
        method: "DELETE",
        headers: { origin: ORIGIN },
      }),
    );
    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith("openai");
  });

  it("削除も未知のproviderは400で拒否する", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { DELETE } = await import("../../app/api/ai-provider-credentials/route");
    const res = await DELETE(
      new Request("http://test/api/ai-provider-credentials?provider=unknown-llm", {
        method: "DELETE",
        headers: { origin: ORIGIN },
      }),
    );
    expect(res.status).toBe(400);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("GETは登録済みの認証情報一覧(マスク済み)を返す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    listMock.mockResolvedValue([
      { provider: "anthropic", model: "claude-sonnet-5", maskedKey: "****xxxx", updatedAt: 0 },
    ]);
    const { GET } = await import("../../app/api/ai-provider-credentials/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credentials: unknown[] };
    expect(body.credentials).toHaveLength(1);
  });

  it("apiKeyが無いPOSTは400で拒否する", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { POST } = await import("../../app/api/ai-provider-credentials/route");
    const res = await POST(
      new Request("http://test/api/ai-provider-credentials", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ provider: "anthropic", model: "claude-sonnet-5" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("保存中に例外が起きたら500とそのエラーメッセージを返す", async () => {
    sessionMock.mockResolvedValue(adminSession);
    upsertMock.mockRejectedValueOnce(new Error("暗号化キーが不正です"));
    const { POST } = await import("../../app/api/ai-provider-credentials/route");
    const res = await POST(
      new Request("http://test/api/ai-provider-credentials", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ provider: "anthropic", apiKey: "sk-ant-xxx", model: "claude-sonnet-5" }),
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("暗号化キーが不正です");
  });
});
