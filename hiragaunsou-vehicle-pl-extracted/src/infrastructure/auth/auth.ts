import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { APIError } from "better-auth/api";
import { verifyGoogleIdToken, type GoogleProfile } from "better-auth/social-providers";
import { decodeJwt } from "jose";
import * as authSchema from "../db/auth-schema";

/**
 * 認証: Google Workspace 限定ログイン (Better Auth) — Next.js + OpenNext for Cloudflare 版。
 * - 許可ドメインは複数指定可能(カンマ区切りの WORKSPACE_DOMAINS)。将来的に協力会社等のドメインを
 *   追加できるよう、単一文字列(better-authのsocialProviders.google.hdは単一ドメイン比較のみ対応)
 *   ではなく、Setによる許可リスト判定を getUserInfo/verifyIdToken のオーバーライドで行う。
 * - 検証は常に Google 署名済みIDトークンの hd claim に対して行う。メールドメインの文字列比較は使わない
 *   (better-auth-google-gate スキルの不変条件)。
 * - D1バインディングはリクエスト単位で OpenNext の getCloudflareContext() から取得し、
 *   都度 createAuth(env) を呼ぶ(モジュールスコープにDB接続やAuthインスタンスを固定しない)。
 */
export type AuthEnv = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WORKSPACE_DOMAINS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

/** カンマ区切りの許可ドメイン一覧を正規化してSetにする(空要素は除外、大文字小文字を無視)。 */
export function parseAllowedWorkspaceDomains(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter((domain) => domain.length > 0),
  );
}

/**
 * Google署名済みIDトークンの hd claim が許可ドメインSetに含まれるかを判定する。
 * 許可リストが空の場合は fail-closed(誰も通さない)。
 */
export function isWorkspaceHostedDomainAllowed(
  allowedDomains: Set<string>,
  hostedDomain: unknown,
): boolean {
  if (allowedDomains.size === 0) return false;
  if (typeof hostedDomain !== "string" || hostedDomain.length === 0) return false;
  return allowedDomains.has(hostedDomain.toLowerCase());
}

export function createAuth(env: AuthEnv) {
  const allowedDomains = parseAllowedWorkspaceDomains(env.WORKSPACE_DOMAINS);

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    // D1に対話型トランザクションは無い(cloudflare-secure-deploy §4の鉄則)ため transaction: false 必須。
    database: drizzleAdapter(drizzle(env.DB, { schema: authSchema }), {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
        // better-authの`hd`オプションは単一ドメイン比較のみ対応のため使わず、
        // getUserInfo/verifyIdTokenをオーバーライドして許可ドメインSetで検証する。
        // どちらもGoogleから直接得た(TLS経由・未改ざん)IDトークンのhd claimを見る。
        // 個人Gmail・許可外ドメイン・グループアドレスはhd不一致で拒否される。
        async getUserInfo(token) {
          if (!token.idToken) return null;
          const profile = decodeJwt(token.idToken) as GoogleProfile;
          if (!isWorkspaceHostedDomainAllowed(allowedDomains, profile.hd)) {
            // 拒否理由をログに残す。hd は組織ドメイン名でありメールアドレス等の個人情報は含めない。
            // これが無いと callback は unable_to_get_user_info としか言わず、原因究明が不可能になる。
            console.warn(
              `Google sign-in rejected: hosted domain "${profile.hd ?? "<none>"}" is not in WORKSPACE_DOMAINS.`,
            );
            return null;
          }
          return {
            user: {
              id: profile.sub,
              name: profile.name,
              email: profile.email,
              image: profile.picture,
              emailVerified: profile.email_verified,
            },
            data: profile,
          };
        },
        async verifyIdToken(idToken, nonce) {
          const jwtClaims = await verifyGoogleIdToken({
            token: idToken,
            audience: env.GOOGLE_CLIENT_ID,
            nonce,
          });
          if (!jwtClaims) return false;
          return isWorkspaceHostedDomainAllowed(allowedDomains, jwtClaims.hd);
        },
      },
    },
    // OAuthコールバックが失敗したときの遷移先。
    // 既定のままだと Better Auth は /api/auth/error に飛ばし、そこは本番(NODE_ENV=production)で
    // 問答無用に `/?error=...` へ302する。`/` は未ログインなので /sign-in へリダイレクトされ、
    // 利用者から見ると「認証したのにサインイン画面に戻る」だけで理由が一切表示されない。
    // 明示的に /sign-in を指定し、error クエリを添えて理由を画面に出せるようにする。
    onAPIError: { errorURL: "/sign-in" },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/social": { window: 60, max: 10 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    // hd (Workspace限定) を通過しても未検証メールのアカウント作成は拒否する
    // (defense-in-depth。better-auth-google-gate スキルの必須項目)。
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!user.emailVerified) {
              throw new APIError("FORBIDDEN", { message: "ACCESS_DENIED" });
            }
            return { data: user };
          },
        },
      },
    },
    // ロール: 山本(input_staff) / 今西(admin) / 社長(executive)。権限マトリクスは
    // 呼び出し側 (Route Handler / Server Component) で解釈する。新規ユーザーは既定 input_staff とし、
    // 昇格は管理者がマスタ管理画面(S9)から行う想定(このスライスでは未実装)。
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "input_staff",
          input: false,
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
