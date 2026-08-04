import { describe, expect, it, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";

/**
 * Google サインインのフル往復(sign-in/social → callback → get-session)を
 * 本番と同じ createAuth() 設定で駆動し、セッションCookieが発行され読み戻せることを検証する。
 * D1 の代わりに in-memory sqlite を使うため drizzle-orm/d1 の drizzle() を差し替える。
 */
const sqlite = new Database(":memory:");
const db = drizzleSqlite(sqlite);

vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => db,
}));

const BASE = "https://app.example.test";

function applyMigrations() {
  const dir = resolve(__dirname, "../../migrations");
  for (const file of ["0000_init_schema.sql", "0001_far_barracuda.sql", "0002_parallel_sally_floyd.sql"]) {
    const sql = readFileSync(resolve(dir, file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
}

function b64url(obj: unknown) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

/** 署名検証しない decodeJwt 用のIDトークンを組み立てる。 */
function makeIdToken(claims: Record<string, unknown>) {
  return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}.sig`;
}

let auth: { handler: (r: Request) => Promise<Response> };

beforeAll(async () => {
  applyMigrations();
  const { createAuth } = await import("../../src/infrastructure/auth/auth");
  auth = createAuth({
    DB: {} as unknown as D1Database,
    BETTER_AUTH_SECRET: "test-secret-value-at-least-32-chars-long",
    BETTER_AUTH_URL: BASE,
    WORKSPACE_DOMAINS: "senpai-lab.com",
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
  });
});

describe("Googleサインインのフル往復", () => {
  it("callback がセッションCookieを発行し get-session で読み戻せる", async () => {
    // 1) sign-in/social
    const signInRes = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      }),
    );
    const signInBody = await signInRes.json();
    console.log("[sign-in] status", signInRes.status);
    console.log("[sign-in] body", JSON.stringify(signInBody));
    console.log("[sign-in] set-cookie", JSON.stringify(signInRes.headers.getSetCookie()));
    expect(signInRes.status).toBe(200);

    const authorizeUrl = new URL((signInBody as { url: string }).url);
    const state = authorizeUrl.searchParams.get("state")!;
    console.log("[sign-in] redirect_uri", authorizeUrl.searchParams.get("redirect_uri"));
    const stateCookies = signInRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    // 2) Google のトークンエンドポイントをスタブ
    const idToken = makeIdToken({
      iss: "https://accounts.google.com",
      aud: "test-client-id",
      sub: "1234567890",
      hd: "senpai-lab.com",
      email: "yamamoto@senpai-lab.com",
      email_verified: true,
      name: "山本",
      picture: "https://example.test/p.png",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ya29.test",
              id_token: idToken,
              token_type: "Bearer",
              expires_in: 3600,
              scope: "openid email profile",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    // 3) callback
    const callbackRes = await auth.handler(
      new Request(`${BASE}/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`, {
        method: "GET",
        headers: { cookie: stateCookies },
      }),
    );
    console.log("[callback] status", callbackRes.status);
    console.log("[callback] location", callbackRes.headers.get("location"));
    console.log("[callback] set-cookie", JSON.stringify(callbackRes.headers.getSetCookie()));

    const sessionCookies = callbackRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c) => !c.endsWith("="))
      .join("; ");

    // 4) get-session
    const sessionRes = await auth.handler(
      new Request(`${BASE}/api/auth/get-session`, {
        method: "GET",
        headers: { cookie: sessionCookies },
      }),
    );
    const sessionBody = await sessionRes.text();
    console.log("[get-session] status", sessionRes.status);
    console.log("[get-session] body", sessionBody);

    expect(callbackRes.status).toBe(302);
    expect(sessionBody).not.toBe("null");
  });

  it("許可外ドメイン(個人Gmail=hdなし)は callback がエラーへリダイレクトする", async () => {
    const signInRes = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      }),
    );
    const { url } = (await signInRes.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const stateCookies = signInRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    // hd claim を持たない個人Gmailアカウントを模した IDトークン
    const idToken = makeIdToken({
      iss: "https://accounts.google.com",
      aud: "test-client-id",
      sub: "9999999999",
      email: "someone@gmail.com",
      email_verified: true,
      name: "個人アカウント",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ access_token: "ya29.test", id_token: idToken, token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const callbackRes = await auth.handler(
      new Request(`${BASE}/api/auth/callback/google?code=c&state=${encodeURIComponent(state)}`, {
        headers: { cookie: stateCookies },
      }),
    );
    console.log("[許可外ドメイン callback] status", callbackRes.status);
    console.log("[許可外ドメイン callback] location", callbackRes.headers.get("location"));

    expect(callbackRes.status).toBe(302);
    // 既定の /api/auth/error ではなく /sign-in に直接戻し、理由をクエリで渡すこと。
    // 既定のままだと本番では /api/auth/error → `/?error=...` → (未ログイン) → /sign-in と
    // 転送され、理由が失われて「認証したのに同じ画面に戻る」だけになる。
    expect(callbackRes.headers.get("location")).toBe("/sign-in?error=unable_to_get_user_info");
  });
});
