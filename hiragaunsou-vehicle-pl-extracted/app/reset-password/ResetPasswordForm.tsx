"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { resetPassword, signInWithPassword } from "../_lib/authClient";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <p className="mt-6 rounded-md border border-danger bg-subtle px-4 py-3 text-sm text-danger">
        リンクが無効です。管理者から届いた最新のリンクをご利用いただくか、管理者にお問い合わせください。
      </p>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("パスワードは8文字以上で設定してください。");
      return;
    }
    if (password !== confirmPassword) {
      setError("パスワードが一致しません。");
      return;
    }

    setPending(true);
    const { error: resetError } = await resetPassword(password, token as string);
    if (resetError) {
      setError(
        "リンクの有効期限が切れているか、既に使用済みです。管理者に新しいリンクの発行を依頼してください。",
      );
      setPending(false);
      return;
    }

    if (email) {
      await signInWithPassword(email, password);
    }
    setDone(true);
    setPending(false);
    window.location.href = "/";
  }

  if (done) {
    return <p className="mt-6 text-sm text-ink-muted">パスワードを設定しました。移動しています…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3 text-left">
      <div>
        <label htmlFor="reset-email" className="text-xs font-semibold text-ink-muted">
          メールアドレス
        </label>
        <input
          id="reset-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="reset-password" className="text-xs font-semibold text-ink-muted">
          新しいパスワード(8文字以上)
        </label>
        <input
          id="reset-password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="reset-password-confirm" className="text-xs font-semibold text-ink-muted">
          新しいパスワード(確認)
        </label>
        <input
          id="reset-password-confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
        />
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="pressable mt-1 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
      >
        {pending ? "設定しています…" : "パスワードを設定する"}
      </button>
    </form>
  );
}
