/**
 * Better Auth が OAuthコールバック失敗時に付ける `error` クエリを、利用者向けの日本語に変換する。
 *
 * Better Auth 側のコード(`src/api/routes/callback.ts` の redirectOnError 呼び出し)が出す値のうち、
 * この画面に到達しうるものだけを扱う。未知のコードは汎用文言にフォールバックさせ、
 * 生のコードを画面に出さない(内部実装の露出を避ける)。
 */
const MESSAGES: Record<string, string> = {
  // hd claim が WORKSPACE_DOMAINS に無い(個人Gmail・許可外ドメイン・グループアドレス)。
  // 運用上いちばん頻度が高いので、次にとるべき行動まで書く。
  unable_to_get_user_info:
    "このGoogleアカウントではサインインできません。会社から配布された社内アカウントでお試しください。",
  access_denied: "Googleでのサインインがキャンセルされました。",
  // state はワンタイム。戻るボタンや古いタブからの再送で起きる。
  state_mismatch: "サインインの有効期限が切れました。お手数ですが、もう一度お試しください。",
  state_expired: "サインインの有効期限が切れました。お手数ですが、もう一度お試しください。",
  no_code: "Googleからの応答が不完全でした。もう一度お試しください。",
  invalid_code: "Googleとの認証に失敗しました。もう一度お試しください。",
  email_not_found: "Googleアカウントからメールアドレスを取得できませんでした。",
  signup_disabled: "このアカウントは登録が許可されていません。管理者にお問い合わせください。",
};

const FALLBACK = "サインインに失敗しました。お手数ですが、もう一度お試しください。";

export function signInErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  return MESSAGES[error] ?? FALLBACK;
}
