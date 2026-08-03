import { describe, expect, it } from "vitest";
import { checkAccess } from "../../src/infrastructure/auth/accessControl";
import type { SessionUser } from "../../src/infrastructure/auth/session";

function user(role: string): SessionUser {
  return { id: "u1", email: "a@example.co.jp", name: "山本", role };
}

describe("checkAccess", () => {
  it("未ログイン(null)は常にfalse", () => {
    expect(checkAccess(null, "view")).toBe(false);
  });

  it("権限を持つロールはtrue", () => {
    expect(checkAccess(user("admin"), "edit_master")).toBe(true);
  });

  it("権限を持たないロールはfalse", () => {
    expect(checkAccess(user("executive"), "input")).toBe(false);
  });

  it("未知のロールはfalse", () => {
    expect(checkAccess(user("guest"), "view")).toBe(false);
  });
});
