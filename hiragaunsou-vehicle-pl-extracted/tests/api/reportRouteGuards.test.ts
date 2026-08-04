import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * /api/report (F12 AI要因分析レポート) の防御ロジックを検証する。
 * この経路はClaude API課金が発生するため、
 *  1. CSRF対策(Originヘッダー検証)
 *  2. コスト暴走対策(1ユーザー1時間あたりの呼び出し上限)
 * の両方が正しく配線されていることをRoute Handler経由で確認する
 * (UseCase自体のロジックは tests/usecase/generateFactorAnalysisReport.test.ts で別途検証済み)。
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

vi.mock("../../src/infrastructure/db/client", () => ({
  createDb: vi.fn(() => ({})),
}));

describe("POST /api/report のガード", () => {
  beforeEach(() => {
    findSinceMock.mockReset();
    findSinceMock.mockResolvedValue([]);
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const { POST } = await import("../../app/api/report/route");
    const res = await POST(
      new Request("http://test/api/report", {
        method: "POST",
        headers: { origin: "https://evil.example.com", "content-type": "application/json" },
        body: JSON.stringify({ targetYearMonth: "2026-05" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("1時間あたり5回を超えると429(コスト暴走対策)", async () => {
    findSinceMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `log-${i}`,
        kind: "factor_analysis_report",
        model: "claude-haiku-4-5",
        inputTokens: 100,
        outputTokens: 100,
        recordedBy: session.id,
        detail: null,
        createdAt: Date.now(),
      })),
    );

    const { POST } = await import("../../app/api/report/route");
    const res = await POST(
      new Request("http://test/api/report", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ targetYearMonth: "2026-05" }),
      }),
    );
    expect(res.status).toBe(429);
  });
});
