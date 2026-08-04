import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * getServerSession は getCloudflareContext / createAuth / next/headers に依存するため、
 * すべてモックしてnull分岐・正常分岐・role未設定時のデフォルト値("input_staff")分岐を検証する。
 */
const getCloudflareContextMock = vi.fn();
const createAuthMock = vi.fn();
const headersMock = vi.fn();

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContextMock(...args),
}));
vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));
vi.mock("../../../src/infrastructure/auth/auth", () => ({
  createAuth: (...args: unknown[]) => createAuthMock(...args),
}));

describe("getServerSession", () => {
  beforeEach(() => {
    vi.resetModules();
    getCloudflareContextMock.mockReset();
    createAuthMock.mockReset();
    headersMock.mockReset();
    getCloudflareContextMock.mockResolvedValue({ env: { DB: {} } });
    headersMock.mockResolvedValue(new Headers());
  });

  it("セッションが無ければnullを返す", async () => {
    const getSession = vi.fn().mockResolvedValue(null);
    createAuthMock.mockReturnValue({ api: { getSession } });

    const { getServerSession } = await import("../../../src/infrastructure/auth/session");
    const result = await getServerSession();

    expect(result).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("セッションがあればSessionUserへマッピングする", async () => {
    const getSession = vi.fn().mockResolvedValue({
      user: { id: "u1", email: "yamamoto@example.com", name: "山本", role: "admin" },
    });
    createAuthMock.mockReturnValue({ api: { getSession } });

    const { getServerSession } = await import("../../../src/infrastructure/auth/session");
    const result = await getServerSession();

    expect(result).toEqual({
      id: "u1",
      email: "yamamoto@example.com",
      name: "山本",
      role: "admin",
    });
  });

  it("roleが未設定のユーザーは既定値 input_staff を補う", async () => {
    const getSession = vi.fn().mockResolvedValue({
      user: { id: "u2", email: "new@example.com", name: "新人" },
    });
    createAuthMock.mockReturnValue({ api: { getSession } });

    const { getServerSession } = await import("../../../src/infrastructure/auth/session");
    const result = await getServerSession();

    expect(result?.role).toBe("input_staff");
  });

  it("getCloudflareContextから取得したenvでcreateAuthを呼ぶ(リクエスト単位で都度生成する)", async () => {
    const env = { DB: { marker: "d1-binding" } };
    getCloudflareContextMock.mockResolvedValue({ env });
    const getSession = vi.fn().mockResolvedValue(null);
    createAuthMock.mockReturnValue({ api: { getSession } });

    const { getServerSession } = await import("../../../src/infrastructure/auth/session");
    await getServerSession();

    expect(createAuthMock).toHaveBeenCalledWith(env);
    expect(getCloudflareContextMock).toHaveBeenCalledWith({ async: true });
  });
});
