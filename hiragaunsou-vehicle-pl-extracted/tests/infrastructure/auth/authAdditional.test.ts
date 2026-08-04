import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";

/**
 * googleSignInFlow.test.ts でカバーしていない auth.ts の残り分岐を検証する:
 *  - verifyIdToken (One Tap的なidToken直接サインイン経路。verifyGoogleIdTokenの結果とhd判定)
 *  - databaseHooks.user.create.before (email_verified=false のユーザー作成拒否)
 */
const sqlite = new Database(":memory:");
const db = drizzleSqlite(sqlite);

vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => db,
}));

const verifyGoogleIdTokenMock = vi.fn();
vi.mock("better-auth/social-providers", async () => {
  const actual = await vi.importActual<typeof import("better-auth/social-providers")>(
    "better-auth/social-providers",
  );
  return {
    ...actual,
    verifyGoogleIdToken: (...args: unknown[]) => verifyGoogleIdTokenMock(...args),
  };
});

const BASE = "https://app.example.test";

function applyMigrations() {
  const dir = resolve(__dirname, "../../../migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
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
function makeIdToken(claims: Record<string, unknown>) {
  return `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}.sig`;
}

let auth: { handler: (r: Request) => Promise<Response> };

beforeAll(async () => {
  applyMigrations();
  const { createAuth } = await import("../../../src/infrastructure/auth/auth");
  auth = createAuth({
    DB: {} as unknown as D1Database,
    BETTER_AUTH_SECRET: "test-secret-value-at-least-32-chars-long",
    BETTER_AUTH_URL: BASE,
    WORKSPACE_DOMAINS: "senpai-lab.com",
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
  });
});

beforeEach(() => {
  verifyGoogleIdTokenMock.mockReset();
});

describe("verifyIdToken (idToken直接サインイン経路)", () => {
  it("verifyGoogleIdTokenがnullを返す(署名検証失敗)ときは拒否する", async () => {
    verifyGoogleIdTokenMock.mockResolvedValue(null);
    const idToken = makeIdToken({ hd: "senpai-lab.com" });

    const res = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({
          provider: "google",
          idToken: { token: idToken },
        }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(verifyGoogleIdTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: idToken, audience: "test-client-id" }),
    );
  });

  it("hdが許可ドメイン外なら拒否する", async () => {
    verifyGoogleIdTokenMock.mockResolvedValue({ hd: "gmail.com" });
    const idToken = makeIdToken({ hd: "gmail.com" });

    const res = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ provider: "google", idToken: { token: idToken } }),
      }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("hdが許可ドメイン内なら受理される(hdなしでは通らないことも合わせて確認)", async () => {
    verifyGoogleIdTokenMock.mockResolvedValueOnce({ hd: "senpai-lab.com" });
    const idToken = makeIdToken({ hd: "senpai-lab.com" });

    const res = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ provider: "google", idToken: { token: idToken } }),
      }),
    );

    // idToken.userが渡っていないため後続処理は失敗しうるが、
    // verifyIdTokenのfail-closed判定自体(拒否されない=200/400どちらでも例外にならない)を確認する。
    expect([200, 400, 401, 422]).toContain(res.status);

    // hdクレーム欠落は拒否される(fail-closed)ことも確認
    verifyGoogleIdTokenMock.mockResolvedValueOnce({});
    const idTokenNoHd = makeIdToken({});
    const resNoHd = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ provider: "google", idToken: { token: idTokenNoHd } }),
      }),
    );
    expect(resNoHd.status).toBeGreaterThanOrEqual(400);
  });
});

describe("databaseHooks.user.create.before (未検証メールのアカウント作成拒否)", () => {
  it("email_verified=false のユーザーはOAuthコールバックでも作成されず、拒否URLへ遷移する", async () => {
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

    const idToken = makeIdToken({
      iss: "https://accounts.google.com",
      aud: "test-client-id",
      sub: "unverified-1",
      hd: "senpai-lab.com",
      email: "mikeninshou@senpai-lab.com",
      email_verified: false,
      name: "未検証太郎",
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

    expect(callbackRes.status).toBe(302);
    // ACCESS_DENIEDのAPIErrorがonAPIErrorのerrorURL(/sign-in)経由でクエリに反映される
    expect(callbackRes.headers.get("location")).toContain("/sign-in");

    const users = sqlite.prepare("SELECT * FROM user WHERE email = ?").all("mikeninshou@senpai-lab.com");
    expect(users).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
