"use client";

import { createAuthClient } from "better-auth/client";

/**
 * Better Auth クライアント(Next.js版)。baseURLは同一オリジンの /api/auth。
 * src/client/src/authClient.ts (旧Vite版) と同じ設計を踏襲する。
 */
export const authClient = createAuthClient({
  baseURL: "/api/auth",
});

export function signInWithGoogle() {
  return authClient.signIn.social({
    provider: "google",
    callbackURL: "/",
  });
}

export function signOut() {
  return authClient.signOut();
}
