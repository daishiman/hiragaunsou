import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { APIError } from "better-auth/api";
import * as schema from "./db/auth-schema";

/**
 * 認証: Google Workspace 限定ログイン (Better Auth)。
 * - Google Workspace 限定は `socialProviders.google.hd` (Google署名済みIDトークンのhd claim) で検証する。
 *   メールドメイン文字列比較は使わない (better-auth-google-gate スキルの不変条件)。
 * - WORKSPACE_DOMAIN / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / BETTER_AUTH_SECRET は
 *   すべて Env 経由のプレースホルダー。実値はユーザーが `.better-auth-google/setup-secrets.mjs` 等で登録する。
 */
export type AuthEnv = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WORKSPACE_DOMAIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

export function createAuth(env: AuthEnv) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: "sqlite",
      schema,
      transaction: false,
    }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Google Workspace 限定。個人Gmail・別ドメイン・グループアドレスは hd 不一致で拒否される。
        hd: env.WORKSPACE_DOMAIN,
        prompt: "select_account",
      },
    },
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
    // src/server/middleware/roleGuard.ts で解釈する。新規ユーザーは既定 input_staff とし、
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
