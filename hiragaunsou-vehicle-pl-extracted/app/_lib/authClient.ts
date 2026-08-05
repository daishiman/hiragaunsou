"use client";

import { createAuthClient } from "better-auth/client";

/**
 * Better Auth クライアント(Next.js版)。同一オリジンの既定 `/api/auth` を使う。
 * 相対URLをbaseURLとして渡すと、Better Auth 1.6系では無効になる。
 */
export const authClient = createAuthClient();

export function signInWithGoogle() {
  return authClient.signIn.social({
    provider: "google",
    callbackURL: "/",
  });
}

/** メール/パスワードでのサインイン(招待経由でパスワードを設定した社内ユーザー向け)。 */
export function signInWithPassword(email: string, password: string) {
  return authClient.signIn.email({ email, password });
}

/**
 * @deprecated パスワードリセット(メール経由)機能は不採用となったため未使用。
 * app/reset-password 配下の旧コンポーネントが参照しているため型互換のためだけに残置している。
 */
export function resetPassword(newPassword: string, token: string) {
  return authClient.resetPassword({ newPassword, token });
}

export function signOut() {
  return authClient.signOut();
}
