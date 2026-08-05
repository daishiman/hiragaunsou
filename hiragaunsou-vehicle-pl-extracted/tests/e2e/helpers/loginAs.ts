import type { BrowserContext } from "@playwright/test";
import { signInAndGetSetCookie } from "./testUsers";

type SessionCookie = { name: string; value: string; url: string };

/** Set-Cookieヘッダー文字列(属性つき)をplaywrightのaddCookies用オブジェクトへ変換する。 */
function parseSetCookie(setCookie: string, url: string): SessionCookie {
  const [pair] = setCookie.split(";");
  const eq = pair.indexOf("=");
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  return { name, value, url };
}

/**
 * 実際にemail/passwordで一度だけサインインし、セッションCookieを取得する。
 * sign-in APIはIPベースのレート制限があるため、describeごとにbeforeAllで1回だけ呼び、
 * 各テストでは injectSessionCookie でCookieを使い回す。
 */
export async function getSessionCookie(
  baseURL: string,
  email: string,
  password: string,
): Promise<SessionCookie> {
  const setCookie = await signInAndGetSetCookie(baseURL, email, password);
  return parseSetCookie(setCookie, baseURL);
}

/** 取得済みのセッションCookieを(新規に生成された)ブラウザコンテキストへ注入する。 */
export async function injectSessionCookie(
  context: BrowserContext,
  cookie: SessionCookie,
): Promise<void> {
  await context.addCookies([cookie]);
}

/** 実際にemail/passwordでサインインし、得たセッションCookieをブラウザコンテキストへ注入する。 */
export async function loginAs(
  context: BrowserContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<void> {
  const cookie = await getSessionCookie(baseURL, email, password);
  await injectSessionCookie(context, cookie);
}
