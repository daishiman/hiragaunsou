import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { createAuth, type AuthEnv } from "./auth";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

/**
 * Server Component / Route Handler から呼ぶ。未ログインなら null を返す。
 * ここでの検証を素通りさせない — Cookieの有無だけで認証済みとみなさない
 * (better-auth-google-gate スキルの不変条件: 保護対象直前で必ず getSession する)。
 */
export async function getServerSession(): Promise<SessionUser | null> {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env as unknown as AuthEnv);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: (session.user as { role?: string }).role ?? "input_staff",
  };
}
