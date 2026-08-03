import { createAuthClient } from "better-auth/client";

/**
 * Better Auth クライアント。baseURLは同一オリジンの /api/auth を指す
 * (wrangler.jsonc の assets.run_worker_first で /api/* が Worker 優先のため、
 *  本番/開発いずれも同一オリジンで動作する)。
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
