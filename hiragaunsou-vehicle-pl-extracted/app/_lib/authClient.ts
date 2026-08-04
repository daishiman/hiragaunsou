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

export function signOut() {
  return authClient.signOut();
}
