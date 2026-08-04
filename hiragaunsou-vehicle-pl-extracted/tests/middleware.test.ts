import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

/**
 * middleware.ts はCSP・クリックジャッキング対策・MIMEスニッフィング対策など
 * セキュリティヘッダーを全ページに付与する箇所。ここが壊れる(ヘッダーが抜ける/緩む)と
 * 個別の画面テストでは検知できないため、ヘッダー単位で明示的に検証する。
 */
describe("middleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("本番相当ではscript-srcにunsafe-evalを含めない", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = middleware(new NextRequest("https://example.com/"));
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("strict-dynamic");
  });

  it("開発モードではscript-srcにunsafe-evalを含める(デバッグ機能のため)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = middleware(new NextRequest("https://example.com/"));
    expect(res.headers.get("Content-Security-Policy")).toContain("unsafe-eval");
  });

  it("クリックジャッキング対策・MIMEスニッフィング対策・HSTSのヘッダーを付与する", () => {
    const res = middleware(new NextRequest("https://example.com/"));
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("CSPはobject-src/frame-ancestorsを禁止し、外部オリジンからのフレーム埋め込みを許さない", () => {
    const csp = middleware(new NextRequest("https://example.com/")).headers.get(
      "Content-Security-Policy",
    );
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("リクエストごとに異なるnonceを発行する(固定値の使い回しを防ぐ)", () => {
    const csp1 = middleware(new NextRequest("https://example.com/")).headers.get(
      "Content-Security-Policy",
    )!;
    const csp2 = middleware(new NextRequest("https://example.com/")).headers.get(
      "Content-Security-Policy",
    )!;
    const nonce1 = csp1.match(/'nonce-([^']+)'/)?.[1];
    const nonce2 = csp2.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce1).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
  });

  it("後段のServer Componentが読めるようx-nonceリクエストヘッダーにも同じnonceを転記する", () => {
    const request = new NextRequest("https://example.com/");
    const res = middleware(request);
    const csp = res.headers.get("Content-Security-Policy")!;
    const nonceInCsp = csp.match(/'nonce-([^']+)'/)?.[1];
    const forwardedNonce = res.headers.get("x-middleware-request-x-nonce");
    expect(forwardedNonce).toBe(nonceInCsp);
  });
});
