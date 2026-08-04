import { describe, expect, it } from "vitest";

describe("Better Auth クライアント", () => {
  it("同一オリジンの既定設定で初期化できる", async () => {
    await expect(import("../../app/_lib/authClient")).resolves.toHaveProperty("authClient");
  });

  it("signInWithGoogleはauthClientの関数を返す(better-authのProxyクライアントのため深いモックはしない)", async () => {
    const { signInWithGoogle } = await import("../../app/_lib/authClient");
    expect(typeof signInWithGoogle).toBe("function");
    // 実際のネットワーク呼び出しは行わず、Promiseを返す関数であることだけ確認する
    const result = signInWithGoogle();
    expect(result).toBeInstanceOf(Promise);
    await result.catch(() => undefined);
  });

  it("signOutはauthClientの関数を返す", async () => {
    const { signOut } = await import("../../app/_lib/authClient");
    expect(typeof signOut).toBe("function");
    const result = signOut();
    expect(result).toBeInstanceOf(Promise);
    await result.catch(() => undefined);
  });
});
