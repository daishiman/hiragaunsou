import { getPlatformProxy } from "wrangler";
import { createAuth, type AuthEnv } from "../../../src/infrastructure/auth/auth";

/**
 * E2E専用のテストユーザー作成・削除ヘルパー。
 *
 * ログイン後の画面をPlaywrightで検証するには、本物のGoogle OAuthを経由しない
 * セッション発行手段が要る(docs/testing-strategy.md参照)。ここでは本番コードを
 * 一切変更せず、既存の招待経由メール/パスワード作成パス(app/api/admin/invitations/route.ts
 * が使っているのと同じ internalInviteProvisioning + auth.api.signUpEmail)をNode.js側から
 * 直接呼び出す。対象は `wrangler dev` 用のローカルD1のみ(getPlatformProxyはwrangler.jsonc
 * の bindings をローカルにエミュレートするだけで、本番D1には一切接続しない)。
 */

export type TestUserSpec = {
  email: string;
  password: string;
  name: string;
  role: "admin" | "input_staff" | "executive";
};

async function getLocalEnv() {
  const proxy = await getPlatformProxy();
  return { env: proxy.env as unknown as AuthEnv & { DB: D1Database }, dispose: proxy.dispose };
}

export async function createTestUser(spec: TestUserSpec): Promise<void> {
  const { env, dispose } = await getLocalEnv();
  try {
    const auth = createAuth(env, {
      internalInviteProvisioning: { email: spec.email, role: spec.role },
    });
    await auth.api.signUpEmail({
      body: { email: spec.email, password: spec.password, name: spec.name },
    });
  } finally {
    await dispose();
  }
}

/** テストユーザーを削除する(session/accountはuser.idへのonDelete cascadeで一緒に消える)。 */
export async function deleteTestUserByEmail(email: string): Promise<void> {
  const { env, dispose } = await getLocalEnv();
  try {
    await env.DB.prepare("DELETE FROM user WHERE email = ?").bind(email).run();
  } finally {
    await dispose();
  }
}

/**
 * ローカルD1の rate_limit テーブルを全消去する(テスト専用)。
 * better-authの既定sign-inレート制限はIPベースのため、直列実行でも
 * テストごとに新規ユーザーでsign-inを繰り返すとすぐ429になる。
 * 各describeのbeforeAllで1回だけ呼び、以降はCookie使い回しでsign-in回数自体を減らす。
 */
export async function clearRateLimits(): Promise<void> {
  const { env, dispose } = await getLocalEnv();
  try {
    await env.DB.prepare("DELETE FROM rate_limit").run();
  } finally {
    await dispose();
  }
}

export async function setUserBanned(email: string, banned: boolean): Promise<void> {
  const { env, dispose } = await getLocalEnv();
  try {
    await env.DB.prepare("UPDATE user SET banned = ? WHERE email = ?")
      .bind(banned ? 1 : 0, email)
      .run();
  } finally {
    await dispose();
  }
}

/** email/passwordで実際にサインインし、Set-CookieヘッダーからセッションCookie文字列を得る。 */
export async function signInAndGetSetCookie(
  baseURL: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${baseURL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("sign-in response did not include Set-Cookie");
  }
  return setCookie;
}
