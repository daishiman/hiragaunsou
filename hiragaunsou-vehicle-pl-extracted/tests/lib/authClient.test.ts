import { describe, expect, it } from "vitest";

describe("Better Auth クライアント", () => {
  it("同一オリジンの既定設定で初期化できる", async () => {
    await expect(import("../../app/_lib/authClient")).resolves.toHaveProperty("authClient");
  });
});
