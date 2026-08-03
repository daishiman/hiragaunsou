import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth, type AuthEnv } from "../../../../src/infrastructure/auth/auth";

/**
 * Better Auth の全ルート (/api/auth/*) を OpenNext for Cloudflare 経由でハンドルする。
 * D1バインディング等はリクエスト単位で取得するため、モジュールスコープにAuthインスタンスを固定しない。
 */
async function handler(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env as unknown as AuthEnv);
  return auth.handler(request);
}

export { handler as GET, handler as POST };
