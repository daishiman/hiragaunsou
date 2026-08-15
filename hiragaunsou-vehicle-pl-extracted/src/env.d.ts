// `wrangler types` は wrangler.jsonc の vars/bindings のみを型生成するため、
// `wrangler secret put` で登録するシークレット(値を静的に持てない)はここで補う。
// 実値は絶対に書かない。キー名の宣言のみ。
export {};

declare global {
  interface Env {
    BETTER_AUTH_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    /** F12 AI要因分析レポート (ClaudeFactorAnalysisClient) 用のシークレット。/ai-settings でD1にキーを登録した場合はそちらが優先され、これは未登録時のフォールバックとしてのみ使われる (app/api/report/route.ts の resolveAnthropicCredential 参照)。 */
    ANTHROPIC_API_KEY: string;
    /**
     * AI連携APIキー(D1の ai_provider_credential テーブル)の暗号化/復号鍵。
     * `openssl rand -base64 32` で生成した32byteの値を `wrangler secret put` で登録する。
     * この鍵を知っている人間だけがAPIキーを復号できるため、絶対に漏らさないこと。
     */
    API_KEY_ENCRYPTION_SECRET: string;
    /**
     * 改善要望に付いてくる画面の写しと診断情報を持ち続ける日数。
     * 未設定なら90日 (RETENTION_DAYS_DEFAULT)。7〜365日の範囲外・読めない値は既定に倒す。
     * 短くしたいときだけ設定する。要望の本文と対応の記録はこの設定では消えない。
     */
    IMPROVEMENT_RETENTION_DAYS?: string;
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
