// `wrangler types` は wrangler.jsonc の vars/bindings のみを型生成するため、
// `wrangler secret put` で登録するシークレット(値を静的に持てない)はここで補う。
// 実値は絶対に書かない。キー名の宣言のみ。
export {};

declare global {
  interface Env {
    BETTER_AUTH_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    /** F12 AI要因分析レポート (ClaudeFactorAnalysisClient) 用のシークレット */
    ANTHROPIC_API_KEY: string;
    /** /usage 概算費用計算用。未設定時はDEFAULT_USAGE_PRICING(Haiku 4.5相当)にフォールバックする */
    ANTHROPIC_PRICE_IN_USD_PER_M?: string;
    ANTHROPIC_PRICE_OUT_USD_PER_M?: string;
    USD_JPY_RATE?: string;
  }

  // `@opennextjs/cloudflare` の `getCloudflareContext()` は `env` を
  // グローバル空間の `CloudflareEnv`(既定は空インターフェース)として型付けする。
  // `wrangler types` が生成する `Env` をここでマージし、DB 等のbindingを認識させる。
  interface CloudflareEnv extends Env {}
}
