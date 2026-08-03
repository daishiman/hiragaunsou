// `wrangler types` は wrangler.jsonc の vars/bindings のみを型生成するため、
// `wrangler secret put` で登録するシークレット(値を静的に持てない)はここで補う。
// 実値は絶対に書かない。キー名の宣言のみ。
export {};

declare global {
  interface Env {
    BETTER_AUTH_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
  }
}
