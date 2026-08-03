import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "../../app/_lib/assertSameOrigin";

describe("isSameOriginRequest", () => {
  const expectedOrigin = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

  it("Originヘッダーが本番オリジンと一致すればtrue", () => {
    const req = new Request("http://test/api/manual-entry", {
      method: "POST",
      headers: { origin: expectedOrigin },
    });
    expect(isSameOriginRequest(req, expectedOrigin)).toBe(true);
  });

  it("Originヘッダーが異なるオリジンならfalse(CSRF拒否)", () => {
    const req = new Request("http://test/api/manual-entry", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });
    expect(isSameOriginRequest(req, expectedOrigin)).toBe(false);
  });

  it("Originヘッダーが無ければfalse(ブラウザfetch以外はデフォルト拒否)", () => {
    const req = new Request("http://test/api/manual-entry", { method: "POST" });
    expect(isSameOriginRequest(req, expectedOrigin)).toBe(false);
  });
});
