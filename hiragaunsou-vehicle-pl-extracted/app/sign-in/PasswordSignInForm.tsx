"use client";

import { useState, type FormEvent } from "react";
import { signInWithPassword } from "../_lib/authClient";

/**
 * メール/パスワードでのサインインフォーム(Gmailを持たない社内ユーザー向け)。
 * アカウントは自己登録できない。必ず管理者が /admin/users からの招待
 * (authMethod="password")経由で発行した初期設定リンクからパスワードを設定した本人のみが使える。
 */
export function PasswordSignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error: signInError } = await signInWithPassword(email, password);
    if (signInError) {
      setError("メールアドレスまたはパスワードが正しくありません。");
      setPending(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-left">
      <div>
        <label htmlFor="password-signin-email" className="text-xs font-semibold text-ink-muted">
          メールアドレス
        </label>
        <input
          id="password-signin-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="password-signin-password" className="text-xs font-semibold text-ink-muted">
          パスワード
        </label>
        <input
          id="password-signin-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
        />
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="pressable mt-1 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-50"
      >
        {pending ? "サインインしています…" : "メールアドレスでサインインする"}
      </button>
    </form>
  );
}
