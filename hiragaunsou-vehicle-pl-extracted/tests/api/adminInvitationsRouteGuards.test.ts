import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * /api/admin/invitations (ユーザー招待, manage_users 権限のみ) の防御ロジックを検証する。
 *  1. 権限ガード(manage_usersを持たないロールは401)
 *  2. CSRF対策(POST/DELETEはOriginヘッダー検証)
 *  3. 入力検証
 * (UseCase自体のロジックは tests/usecase/manageInvitations.test.ts で別途検証済み)
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const { sessionMock, listMock, upsertMock, revokeMock, findByEmailMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  listMock: vi.fn(async () => []),
  upsertMock: vi.fn(async () => {}),
  revokeMock: vi.fn(async () => {}),
  findByEmailMock: vi.fn(async () => null),
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

class D1InvitationRepositoryMock {
  list = listMock;
  findPendingByEmail = vi.fn(async () => null);
  upsert = upsertMock;
  revoke = revokeMock;
  markAccepted = vi.fn(async () => {});
}
vi.mock("../../src/infrastructure/db/D1InvitationRepository", () => ({
  D1InvitationRepository: D1InvitationRepositoryMock,
}));

class D1UserRepositoryMock {
  list = vi.fn(async () => []);
  findById = vi.fn(async () => null);
  findByEmail = findByEmailMock;
  updateRoleAndBanned = vi.fn(async () => {});
  updateName = vi.fn(async () => {});
  deleteSessions = vi.fn(async () => {});
  deleteUser = vi.fn(async () => {});
}
vi.mock("../../src/infrastructure/db/D1UserRepository", () => ({
  D1UserRepository: D1UserRepositoryMock,
}));

const adminSession = { id: "admin-1", email: "admin@example.co.jp", name: "管理者", role: "admin" as const };
const staffSession = { id: "staff-1", email: "staff@example.co.jp", name: "入力担当", role: "input_staff" as const };

describe("/api/admin/invitations のガード", () => {
  beforeEach(() => {
    sessionMock.mockReset();
    listMock.mockClear();
    upsertMock.mockClear();
    revokeMock.mockClear();
    findByEmailMock.mockReset();
    findByEmailMock.mockResolvedValue(null);
  });

  it("manage_usersを持たないロールはGETでも401", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { GET } = await import("../../app/api/admin/invitations/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("Originが一致しなければPOSTは403(CSRF対策)", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { POST } = await import("../../app/api/admin/invitations/route");
    const res = await POST(
      new Request("http://test/api/admin/invitations", {
        method: "POST",
        headers: { origin: "https://evil.example.com", "content-type": "application/json" },
        body: JSON.stringify({ email: "new@example.co.jp", role: "input_staff" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければDELETEも403(CSRF対策)", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { DELETE } = await import("../../app/api/admin/invitations/route");
    const res = await DELETE(
      new Request("http://test/api/admin/invitations?id=inv-1", {
        method: "DELETE",
        headers: { origin: "https://evil.example.com" },
      }),
    );
    expect(res.status).toBe(403);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("不正なroleは400で拒否する", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { POST } = await import("../../app/api/admin/invitations/route");
    const res = await POST(
      new Request("http://test/api/admin/invitations", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email: "new@example.co.jp", role: "superuser" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("既存ユーザーのメールアドレスは400で拒否する", async () => {
    sessionMock.mockResolvedValue(adminSession);
    findByEmailMock.mockResolvedValueOnce({
      id: "u1",
      name: "既存",
      email: "exists@example.co.jp",
      role: "input_staff",
      banned: false,
      createdAt: 0,
    });
    const { POST } = await import("../../app/api/admin/invitations/route");
    const res = await POST(
      new Request("http://test/api/admin/invitations", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email: "exists@example.co.jp", role: "input_staff" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("正常なPOSTはrepo.upsertを呼ぶ", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { POST } = await import("../../app/api/admin/invitations/route");
    const res = await POST(
      new Request("http://test/api/admin/invitations", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email: "new@example.co.jp", role: "input_staff" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("idの無いDELETEは400", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { DELETE } = await import("../../app/api/admin/invitations/route");
    const res = await DELETE(
      new Request("http://test/api/admin/invitations", { method: "DELETE", headers: { origin: ORIGIN } }),
    );
    expect(res.status).toBe(400);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("正常なDELETEはrepo.revokeを呼ぶ", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { DELETE } = await import("../../app/api/admin/invitations/route");
    const res = await DELETE(
      new Request("http://test/api/admin/invitations?id=inv-1", {
        method: "DELETE",
        headers: { origin: ORIGIN },
      }),
    );
    expect(res.status).toBe(200);
    expect(revokeMock).toHaveBeenCalledWith("inv-1");
  });
});
