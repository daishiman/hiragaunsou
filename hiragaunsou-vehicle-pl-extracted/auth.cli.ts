/**
 * Better Auth CLI 専用設定 (`npx @better-auth/cli generate` 用)。
 * ランタイム(src/server/auth.ts)とは分離し、副作用なしでスキーマ生成のみ行う。
 * D1へは接続しない(in-memory sqlite で schema shape のみ与える)。
 */
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";

const sqlite = new Database(":memory:");
const db = drizzle(sqlite);

export const auth = betterAuth({
  baseURL: "http://localhost:8787",
  secret: "cli-schema-generation-only",
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {},
  }),
  socialProviders: {
    google: {
      clientId: "placeholder",
      clientSecret: "placeholder",
      hd: "example.co.jp",
    },
  },
  // ランタイム(src/server/auth.ts)と同じ rateLimit.storage="database" を CLI 設定にも
  // 反映し、rate_limit テーブルを schema生成の対象に含める。
  rateLimit: {
    enabled: true,
    storage: "database",
  },
  // ロール: 山本(input_staff/入力担当) / 今西(admin/管理者) / 社長(executive/経営)。
  // 権限マトリクス(docs/requirement.md 4章)に対応。既定は input_staff。
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
