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
     * 改善要望を GitHub Issue として起票するためのトークン。
     *
     * 取得先(fine-grained 推奨): https://github.com/settings/personal-access-tokens/new
     * 対象リポジトリに起票先だけを指定し、Repository permissions の
     * Issues を Read and write にする。それ以外は付けない。
     * 有効期限を設定した場合、期限切れで起票が止まる(下書きの確認は続けられる)。
     * classic token の代替: https://github.com/settings/tokens/new?scopes=repo
     * (repo スコープ。権限が広くなるため fine-grained を推奨)
     *
     * 任意設定。未設定なら「Issueにする」操作が案内つきで断られるだけで、他の機能は動く
     * (だから wrangler.jsonc の secrets.required には入れない)。
     */
    GITHUB_ISSUE_TOKEN?: string;
    /** 起票先リポジトリ。`owner/repo` 形式。GITHUB_ISSUE_TOKEN と両方揃って初めて起票できる。 */
    GITHUB_ISSUE_REPO?: string;
    /**
     * 画面の写しを Issue へ貼るか。"true" のときだけ貼る(既定は貼らない)。
     * 貼るにはトークンに Contents: Read and write も要る。
     * 貼らない設定でも、Issue には管理画面の該当詳細ページへのリンクが必ず載る。
     */
    GITHUB_ISSUE_ATTACH_SHOT?: string;
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
