import { describe, expect, it, vi } from "vitest";

/**
 * Presentation層(app/api/**)の認証ガードを検証する統合テスト。
 * 各Route Handlerは `getServerSession()` が null を返す限り、
 * Cloudflare binding(D1/R2/AI)へは一切触れず 401 を返すべき
 * (checkAccess/hasPermission のロジック自体は tests/infrastructure/accessControl.test.ts で検証済み。
 *  ここではRoute Handlerが実際にそのガードを呼び出し、正しく配線されていることを確認する)。
 *
 * 未ログイン時は getCloudflareContext を一切呼ばないため、Cloudflare bindingをモックせずに検証できる。
 */
vi.mock("../../src/infrastructure/auth/session", () => ({
  getServerSession: vi.fn(async () => null),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => {
    throw new Error("getCloudflareContext should not be called when unauthenticated");
  }),
}));

describe("Route Handlerの認証ガード(未ログイン→401)", () => {
  it("GET /api/vehicle-pl は未ログインで401", async () => {
    const { GET } = await import("../../app/api/vehicle-pl/route");
    const res = await GET(new Request("http://test/api/vehicle-pl?yearMonth=2026-05"));
    expect(res.status).toBe(401);
  });

  it("GET /api/todo は未ログインで401", async () => {
    const { GET } = await import("../../app/api/todo/route");
    const res = await GET(new Request("http://test/api/todo?yearMonth=2026-05"));
    expect(res.status).toBe(401);
  });

  it("POST /api/todo/[id]/resolve は未ログインで401", async () => {
    const { POST } = await import("../../app/api/todo/[id]/resolve/route");
    const res = await POST(new Request("http://test/api/todo/abc/resolve", { method: "POST" }), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/manual-entry は未ログインで401", async () => {
    const { POST } = await import("../../app/api/manual-entry/route");
    const res = await POST(new Request("http://test/api/manual-entry", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("POST /api/import/[sourceType] は未ログインで401", async () => {
    const { POST } = await import("../../app/api/import/[sourceType]/route");
    const res = await POST(new Request("http://test/api/import/vehicle_operation", { method: "POST" }), {
      params: Promise.resolve({ sourceType: "vehicle_operation" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/report は未ログインで401", async () => {
    const { POST } = await import("../../app/api/report/route");
    const res = await POST(new Request("http://test/api/report", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("GET /api/me は未ログインでも200・user:nullを返す(認証ガード対象外の素通しエンドポイント)", async () => {
    const { GET } = await import("../../app/api/me/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown };
    expect(body.user).toBeNull();
  });
});
