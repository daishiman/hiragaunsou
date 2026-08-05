import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * /api/admin/users (全ユーザー管理, manage_users 権限のみ) の防御ロジックを検証する。
 *  1. 権限ガード(manage_usersを持たないロールは401)
 *  2. CSRF対策(PATCH/DELETEはOriginヘッダー検証)
 *  3. 入力検証
 * (UseCase自体のロジックは tests/usecase/manageUsers.test.ts で別途検証済み)
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const { sessionMock, listMock, updateMock, deleteMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  listMock: vi.fn(async () => []),
  updateMock: vi.fn(async () => {}),
  deleteMock: vi.fn(async () => {}),
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

class D1UserRepositoryMock {
  list = listMock;
  findById = vi.fn(async () => ({
    id: "staff-1",
    name: "入力担当",
    email: "staff@example.co.jp",
    role: "input_staff",
    banned: false,
    createdAt: 0,
  }));
  findByEmail = vi.fn(async () => null);
  updateRoleAndBanned = updateMock;
  updateName = vi.fn(async () => {});
  deleteSessions = vi.fn(async () => {});
  deleteUser = deleteMock;
}
vi.mock("../../src/infrastructure/db/D1UserRepository", () => ({
  D1UserRepository: D1UserRepositoryMock,
}));

const adminSession = { id: "admin-1", email: "admin@example.co.jp", name: "管理者", role: "admin" as const };
const staffSession = { id: "staff-1", email: "staff@example.co.jp", name: "入力担当", role: "input_staff" as const };

describe("/api/admin/users のガード", () => {
  beforeEach(() => {
    sessionMock.mockReset();
    listMock.mockClear();
    updateMock.mockClear();
    deleteMock.mockClear();
  });

  it("manage_usersを持たないロールはGETでも401", async () => {
    sessionMock.mockResolvedValue(staffSession);
    const { GET } = await import("../../app/api/admin/users/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("Originが一致しなければPATCHは403(CSRF対策)", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { PATCH } = await import("../../app/api/admin/users/route");
    const res = await PATCH(
      new Request("http://test/api/admin/users", {
        method: "PATCH",
        headers: { origin: "https://evil.example.com", "content-type": "application/json" },
        body: JSON.stringify({ userId: "staff-1", banned: true }),
      }),
    );
    expect(res.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければDELETEも403(CSRF対策)", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { DELETE } = await import("../../app/api/admin/users/route");
    const res = await DELETE(
      new Request("http://test/api/admin/users?userId=staff-1", {
        method: "DELETE",
        headers: { origin: "https://evil.example.com" },
      }),
    );
    expect(res.status).toBe(403);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("不正なroleは400で拒否する", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { PATCH } = await import("../../app/api/admin/users/route");
    const res = await PATCH(
      new Request("http://test/api/admin/users", {
        method: "PATCH",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ userId: "staff-1", role: "superuser" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("userId無しのDELETEは400", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { DELETE } = await import("../../app/api/admin/users/route");
    const res = await DELETE(
      new Request("http://test/api/admin/users", { method: "DELETE", headers: { origin: ORIGIN } }),
    );
    expect(res.status).toBe(400);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("正常なDELETEはrepo.deleteUserを呼ぶ", async () => {
    sessionMock.mockResolvedValue(adminSession);
    const { DELETE } = await import("../../app/api/admin/users/route");
    const res = await DELETE(
      new Request("http://test/api/admin/users?userId=staff-1", {
        method: "DELETE",
        headers: { origin: ORIGIN },
      }),
    );
    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith("staff-1");
  });
});
