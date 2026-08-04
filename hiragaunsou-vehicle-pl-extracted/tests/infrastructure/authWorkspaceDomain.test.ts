import { describe, expect, it } from "vitest";
import {
  isWorkspaceHostedDomainAllowed,
  parseAllowedWorkspaceDomains,
} from "../../src/infrastructure/auth/auth";

describe("Google Workspace許可ドメイン", () => {
  it("カンマ区切りのドメインを正規化し、Googleのhd claimだけで判定する", () => {
    const allowed = parseAllowedWorkspaceDomains(" Hiragaunsou.co.jp, example.co.jp ,");

    expect(isWorkspaceHostedDomainAllowed(allowed, "hiragaunsou.co.jp")).toBe(true);
    expect(isWorkspaceHostedDomainAllowed(allowed, "EXAMPLE.CO.JP")).toBe(true);
    expect(isWorkspaceHostedDomainAllowed(allowed, "gmail.com")).toBe(false);
    expect(isWorkspaceHostedDomainAllowed(allowed, undefined)).toBe(false);
  });

  it("許可ドメインが未設定ならfail-closedで拒否する", () => {
    expect(isWorkspaceHostedDomainAllowed(parseAllowedWorkspaceDomains(""), "hiragaunsou.co.jp")).toBe(false);
  });
});
