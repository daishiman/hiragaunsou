import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * POST /api/report が、Anthropicの認証情報をどこから取るかの優先順位を検証する。
 *  1. /ai-settings でD1に登録されたキー(あれば最優先、復号して使う)
 *  2. Cloudflare Workers Secretの env.ANTHROPIC_API_KEY (D1に無い場合のフォールバック)
 *  3. どちらも無ければClaude APIを呼ばずに500で明確なエラーを返す
 * (CSRF・レート制限のガードは tests/api/reportRouteGuards.test.ts で別途検証済み)
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";
const session = { id: "user-1", email: "exec@example.co.jp", name: "社長", role: "executive" as const };

vi.mock("../../src/infrastructure/auth/session", () => ({
  getServerSession: vi.fn(async () => session),
}));

vi.mock("../../src/infrastructure/db/client", () => ({
  createDb: vi.fn(() => ({})),
}));

const { findSinceMock, D1UsageLogRepositoryMock } = vi.hoisted(() => {
  const findSinceMock = vi.fn(async () => []);
  class D1UsageLogRepositoryMock {
    findSince = findSinceMock;
    record = vi.fn();
  }
  return { findSinceMock, D1UsageLogRepositoryMock };
});
vi.mock("../../src/infrastructure/db/D1UsageLogRepository", () => ({
  D1UsageLogRepository: D1UsageLogRepositoryMock,
}));

const { findByYearMonthMock, D1VehiclePlRepositoryMock } = vi.hoisted(() => {
  const findByYearMonthMock = vi.fn(async () => [{ no: "1", profit: 1000, sales: 5000, expense: 4000 }]);
  class D1VehiclePlRepositoryMock {
    findByYearMonth = findByYearMonthMock;
  }
  return { findByYearMonthMock, D1VehiclePlRepositoryMock };
});
vi.mock("../../src/infrastructure/db/D1VehiclePlRepository", () => ({
  D1VehiclePlRepository: D1VehiclePlRepositoryMock,
}));

const { findSecretMock } = vi.hoisted(() => ({ findSecretMock: vi.fn(async () => null) }));
class D1AiProviderCredentialRepositoryMock {
  findSecret = findSecretMock;
}
vi.mock("../../src/infrastructure/db/D1AiProviderCredentialRepository", () => ({
  D1AiProviderCredentialRepository: D1AiProviderCredentialRepositoryMock,
}));

vi.mock("../../src/infrastructure/security/apiKeyEncryption", () => ({
  decryptApiKey: vi.fn(async ({ cipher }: { cipher: string }) => `decrypted:${cipher}`),
}));

const { claudeClientCtorMock } = vi.hoisted(() => ({ claudeClientCtorMock: vi.fn() }));
class ClaudeFactorAnalysisClientMock {
  constructor(options: { apiKey: string; model?: string }) {
    claudeClientCtorMock(options);
  }
  async generateReport() {
    return {
      report: { summary: "", keyDrivers: [], recommendations: [], lowConfidenceNotes: [] },
      usage: { model: "dummy", inputTokens: 1, outputTokens: 1 },
    };
  }
}
vi.mock("../../src/infrastructure/ai/ClaudeFactorAnalysisClient", () => ({
  ClaudeFactorAnalysisClient: ClaudeFactorAnalysisClientMock,
}));

function postReport() {
  return import("../../app/api/report/route").then(({ POST }) =>
    POST(
      new Request("http://test/api/report", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ targetYearMonth: "2026-05" }),
      }),
    ),
  );
}

describe("POST /api/report のAnthropic認証情報の優先順位", () => {
  beforeEach(() => {
    vi.resetModules();
    findSinceMock.mockClear();
    findByYearMonthMock.mockClear();
    findSecretMock.mockReset();
    claudeClientCtorMock.mockClear();
  });

  it("D1に登録済みのキーがあれば、env.ANTHROPIC_API_KEYより優先して復号して使う", async () => {
    vi.doMock("@opennextjs/cloudflare", () => ({
      getCloudflareContext: vi.fn(async () => ({
        env: {
          DB: {},
          ANTHROPIC_API_KEY: "env-fallback-key",
          API_KEY_ENCRYPTION_SECRET: "dummy-secret",
          BETTER_AUTH_URL: ORIGIN,
        },
      })),
    }));
    findSecretMock.mockResolvedValue({
      provider: "anthropic",
      apiKeyCipher: "cipher-abc",
      apiKeyIv: "iv-abc",
      model: "claude-opus-5",
    });

    const res = await postReport();
    expect(res.status).toBe(200);
    expect(claudeClientCtorMock).toHaveBeenCalledWith({
      apiKey: "decrypted:cipher-abc",
      model: "claude-opus-5",
    });
  });

  it("D1に登録が無ければenv.ANTHROPIC_API_KEYにフォールバックする", async () => {
    vi.doMock("@opennextjs/cloudflare", () => ({
      getCloudflareContext: vi.fn(async () => ({
        env: {
          DB: {},
          ANTHROPIC_API_KEY: "env-fallback-key",
          API_KEY_ENCRYPTION_SECRET: "dummy-secret",
          BETTER_AUTH_URL: ORIGIN,
        },
      })),
    }));
    findSecretMock.mockResolvedValue(null);

    const res = await postReport();
    expect(res.status).toBe(200);
    expect(claudeClientCtorMock).toHaveBeenCalledWith({ apiKey: "env-fallback-key", model: undefined });
  });

  it("D1にもenv.ANTHROPIC_API_KEYにも無ければClaudeを呼ばずに500を返す", async () => {
    vi.doMock("@opennextjs/cloudflare", () => ({
      getCloudflareContext: vi.fn(async () => ({
        env: { DB: {}, API_KEY_ENCRYPTION_SECRET: "dummy-secret", BETTER_AUTH_URL: ORIGIN },
      })),
    }));
    findSecretMock.mockResolvedValue(null);

    const res = await postReport();
    expect(res.status).toBe(500);
    expect(claudeClientCtorMock).not.toHaveBeenCalled();
  });
});
