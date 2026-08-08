import { describe, expect, it, vi, beforeEach } from "vitest";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../src/infrastructure/auth/session";

/**
 * /api/deficit-analysis の防御ロジックを検証する。
 * POST(AI分析実行)はClaude API課金が発生するため /api/report と同じ2段防御を持つ:
 *  1. CSRF対策(Originヘッダー検証)
 *  2. コスト暴走対策(1ユーザー1時間あたりの呼び出し上限)
 * GET(キャッシュ取得)はview権限のみで良く、AI呼び出しを伴わない。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";
const session = { id: "user-1", email: "exec@example.co.jp", name: "社長", role: "executive" as const };

vi.mock("../../src/infrastructure/auth/session", () => ({
  getServerSession: vi.fn(async () => session),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({
    env: { DB: {}, ANTHROPIC_API_KEY: "test-key", BETTER_AUTH_URL: ORIGIN },
  })),
}));

vi.mock("../../src/infrastructure/db/client", () => ({
  createDb: vi.fn(() => ({})),
}));

const { findSinceMock, D1UsageLogRepositoryMock } = vi.hoisted(() => {
  const findSinceMock = vi.fn();
  class D1UsageLogRepositoryMock {
    findSince = findSinceMock;
    record = vi.fn();
  }
  return { findSinceMock, D1UsageLogRepositoryMock };
});
vi.mock("../../src/infrastructure/db/D1UsageLogRepository", () => ({
  D1UsageLogRepository: D1UsageLogRepositoryMock,
}));

const { findSecretMock } = vi.hoisted(() => ({ findSecretMock: vi.fn(async () => null) }));
class D1AiProviderCredentialRepositoryMock {
  findSecret = findSecretMock;
}
vi.mock("../../src/infrastructure/db/D1AiProviderCredentialRepository", () => ({
  D1AiProviderCredentialRepository: D1AiProviderCredentialRepositoryMock,
}));

const { findByYearMonthMock } = vi.hoisted(() => ({ findByYearMonthMock: vi.fn(async () => []) }));
class D1DeficitFactorAnalysisRepositoryMock {
  findByYearMonth = findByYearMonthMock;
  findOne = vi.fn(async () => null);
  upsertMany = vi.fn();
}
vi.mock("../../src/infrastructure/db/D1DeficitFactorAnalysisRepository", () => ({
  D1DeficitFactorAnalysisRepository: D1DeficitFactorAnalysisRepositoryMock,
}));

vi.mock("../../src/infrastructure/db/D1VehiclePlRepository", () => ({
  D1VehiclePlRepository: class {
    findByYearMonth = vi.fn(async () => []);
  },
}));

// 赤字3分類の閾値は rate_master から取る (既定値を黙って使わない)。
vi.mock("../../src/infrastructure/db/D1MasterRepository", () => ({
  D1RateMasterRepository: class {
    getDeficitThresholds = vi.fn(async () => ({
      idleSales: 300000,
      repairSpike: 300000,
      breakEvenKmPrice: 177,
    }));
  },
}));

function postAnalysis() {
  return import("../../app/api/deficit-analysis/route").then(({ POST }) =>
    POST(
      new Request("http://test/api/deficit-analysis", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ yearMonth: "2026-05" }),
      }),
    ),
  );
}

describe("POST /api/deficit-analysis のガード", () => {
  beforeEach(() => {
    findSinceMock.mockReset();
    findSinceMock.mockResolvedValue([]);
    findSecretMock.mockReset();
    findSecretMock.mockResolvedValue(null);
    findByYearMonthMock.mockReset();
    findByYearMonthMock.mockResolvedValue([]);
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const { POST } = await import("../../app/api/deficit-analysis/route");
    const res = await POST(
      new Request("http://test/api/deficit-analysis", {
        method: "POST",
        headers: { origin: "https://evil.example.com", "content-type": "application/json" },
        body: JSON.stringify({ yearMonth: "2026-05" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("1時間あたり5回を超えると429(コスト暴走対策)", async () => {
    findSinceMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `log-${i}`,
        kind: "deficit_factor_analysis",
        model: "claude-haiku-4-5",
        inputTokens: 100,
        outputTokens: 100,
        recordedBy: session.id,
        detail: null,
        createdAt: Date.now(),
      })),
    );

    const res = await postAnalysis();
    expect(res.status).toBe(429);
  });
});

describe("GET /api/deficit-analysis", () => {
  it("ymが無ければ400", async () => {
    const { GET } = await import("../../app/api/deficit-analysis/route");
    const res = await GET(new Request("http://test/api/deficit-analysis"));
    expect(res.status).toBe(400);
  });

  it("キャッシュ済みの分析結果を返す(AI呼び出しなし)", async () => {
    findByYearMonthMock.mockResolvedValue([
      { vehicleNo: "2", yearMonth: "2026-05", summary: "既存分析", factors: [], model: "claude-haiku-4-5", updatedAt: 0 },
    ]);
    const { GET } = await import("../../app/api/deficit-analysis/route");
    const res = await GET(new Request("http://test/api/deficit-analysis?ym=2026-05"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(1);
  });

  it("未ログイン(session===null)なら401", async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null);
    const { GET } = await import("../../app/api/deficit-analysis/route");
    const res = await GET(new Request("http://test/api/deficit-analysis?ym=2026-05"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/deficit-analysis の権限・入力チェック", () => {
  beforeEach(() => {
    findSinceMock.mockReset();
    findSinceMock.mockResolvedValue([]);
    findSecretMock.mockReset();
    findSecretMock.mockResolvedValue(null);
    findByYearMonthMock.mockReset();
    findByYearMonthMock.mockResolvedValue([]);
  });

  it("未ログインならreport_settings権限が無く401", async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null);
    const res = await postAnalysis();
    expect(res.status).toBe(401);
  });

  it("yearMonthが無ければ400", async () => {
    const { POST } = await import("../../app/api/deficit-analysis/route");
    const res = await POST(
      new Request("http://test/api/deficit-analysis", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("AnthropicのAPIキーが未設定なら500", async () => {
    vi.mocked(getCloudflareContext).mockResolvedValueOnce({
      env: { DB: {}, BETTER_AUTH_URL: ORIGIN },
    } as never);
    const res = await postAnalysis();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("APIキー");
  });

  it("対象の赤字車両が無ければAI呼び出しをせず200で空の結果を返す", async () => {
    const res = await postAnalysis();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; analyzedCount: number };
    expect(body.results).toEqual([]);
    expect(body.analyzedCount).toBe(0);
  });
});
