import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth, type AuthEnv } from "../../../../src/infrastructure/auth/auth";

/**
 * Better Auth の全ルート (/api/auth/*) を OpenNext for Cloudflare 経由でハンドルする。
 * D1バインディング等はリクエスト単位で取得するため、モジュールスコープにAuthインスタンスを固定しない。
 */
async function handler(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env as unknown as AuthEnv);
  const response = await auth.handler(request);

  // databaseHooks.session.create.before (auth.ts) が凍結ユーザーを検知して投げる
  // APIError("FORBIDDEN", {message:"ACCOUNT_DISABLED"}) は、OAuthコールバック処理自体の
  // エラー(unable_to_get_user_info等)と違って onAPIError.errorURL の対象にならず、
  // 生の403 JSONがそのままブラウザのトップレベルナビゲーションに表示されてしまう。
  // callbackパスに限り、/sign-in への302へ変換して他のエラーと同じ導線に揃える
  // (アクセス拒否という結果自体は変えず、UXだけを既存のエラー導線に統一する)。
  if (
    response.status === 403 &&
    new URL(request.url).pathname.includes("/api/auth/callback/") &&
    (await response.clone().text()).includes("ACCOUNT_DISABLED")
  ) {
    return Response.redirect(new URL("/sign-in?error=account_disabled", request.url), 302);
  }

  return response;
}

export { handler as GET, handler as POST };
