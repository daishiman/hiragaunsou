"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signOut, authClient } from "../../_lib/authClient";

type SaveState = { status: "idle" } | { status: "saving" } | { status: "error"; message: string };

export function ProfileForm({
  name: initialName,
  email: initialEmail,
  roleLabel,
  hasPasswordCredential,
}: {
  userId: string;
  name: string;
  email: string;
  roleLabel: string;
  hasPasswordCredential: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [signingOut, setSigningOut] = useState(false);

  const [email, setEmail] = useState(initialEmail);
  const [newEmail, setNewEmail] = useState(initialEmail);
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [emailSaveState, setEmailSaveState] = useState<SaveState | { status: "success" }>({
    status: "idle",
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordSaveState, setPasswordSaveState] = useState<SaveState | { status: "success" }>({
    status: "idle",
  });

  async function handleChangeEmail(e: FormEvent) {
    e.preventDefault();
    setEmailSaveState({ status: "saving" });
    try {
      const res = await fetch("/api/me/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: emailCurrentPassword, newEmail }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; email?: string } | null;
      if (!res.ok) {
        setEmailSaveState({ status: "error", message: data?.error ?? "変更に失敗しました" });
        return;
      }
      setEmail(data?.email ?? newEmail);
      setEmailCurrentPassword("");
      setEmailSaveState({ status: "success" });
    } catch {
      setEmailSaveState({ status: "error", message: "通信エラーが発生しました" });
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setPasswordSaveState({ status: "error", message: "新しいパスワードは8文字以上で設定してください。" });
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordSaveState({ status: "error", message: "新しいパスワードが一致しません。" });
      return;
    }
    setPasswordSaveState({ status: "saving" });
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      setPasswordSaveState({ status: "error", message: "現在のパスワードが正しくありません。" });
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setPasswordSaveState({ status: "success" });
  }

  async function handleSave() {
    setSaveState({ status: "saving" });
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setSaveState({ status: "error", message: data?.error ?? "更新に失敗しました" });
        return;
      }
      setSaveState({ status: "idle" });
      router.refresh();
    } catch {
      setSaveState({ status: "error", message: "通信エラーが発生しました" });
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/sign-in");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">アカウント情報</h2>
        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            氏名
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>

          <div className="flex flex-col gap-1 text-xs text-ink-muted">
            メールアドレス
            <p className="text-sm text-ink">{email}</p>
            {!hasPasswordCredential ? (
              <span className="text-[11px] text-ink-muted">
                Googleサインインのアカウントのため、この画面からは変更できません。
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-1 text-xs text-ink-muted">
            ロール
            <p className="text-sm text-ink">{roleLabel}</p>
            <span className="text-[11px] text-ink-muted">ロールの変更は管理者にご依頼ください。</span>
          </div>

          {saveState.status === "error" ? (
            <div className="rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs">
              {saveState.message}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleSave}
            disabled={saveState.status === "saving" || name.trim().length === 0}
            className="btn btn-primary pressable self-start"
          >
            {saveState.status === "saving" ? "保存しています…" : "保存する"}
          </button>
        </div>
      </section>

      {hasPasswordCredential ? (
        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink">メールアドレスの変更</h2>
          <p className="mt-1 text-xs text-ink-muted">
            確認メールは送信されません。現在のパスワードを入力すると、その場で変更が反映されます
            (変更後は他のデバイス・タブのログイン状態は失効します)。
          </p>
          <form onSubmit={handleChangeEmail} className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              新しいメールアドレス
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              現在のパスワード(本人確認のため)
              <input
                type="password"
                required
                autoComplete="current-password"
                value={emailCurrentPassword}
                onChange={(e) => setEmailCurrentPassword(e.target.value)}
                className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            {emailSaveState.status === "error" ? (
              <p className="text-xs text-danger">{emailSaveState.message}</p>
            ) : null}
            {emailSaveState.status === "success" ? (
              <p className="text-xs text-brand-deep">メールアドレスを変更しました。次回からは新しいメールアドレスでサインインしてください。</p>
            ) : null}
            <button
              type="submit"
              disabled={emailSaveState.status === "saving" || newEmail.trim().length === 0}
              className="btn btn-quiet pressable self-start"
            >
              {emailSaveState.status === "saving" ? "変更しています…" : "メールアドレスを変更する"}
            </button>
          </form>
        </section>
      ) : null}

      {hasPasswordCredential ? (
        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink">パスワードの変更</h2>
          <p className="mt-1 text-xs text-ink-muted">
            メール/パスワードでサインインしているアカウントのパスワードを変更します。
          </p>
          <form onSubmit={handleChangePassword} className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              現在のパスワード
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              新しいパスワード(8文字以上)
              <input
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              新しいパスワード(確認)
              <input
                type="password"
                required
                autoComplete="new-password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            {passwordSaveState.status === "error" ? (
              <p className="text-xs text-danger">{passwordSaveState.message}</p>
            ) : null}
            {passwordSaveState.status === "success" ? (
              <p className="text-xs text-brand-deep">パスワードを変更しました。</p>
            ) : null}
            <button
              type="submit"
              disabled={passwordSaveState.status === "saving"}
              className="btn btn-quiet pressable self-start"
            >
              {passwordSaveState.status === "saving" ? "変更しています…" : "パスワードを変更する"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">ログアウト</h2>
        <p className="mt-1 text-xs text-ink-muted">このデバイスでのログイン状態を終了します。</p>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="pressable mt-3 rounded-md border border-caution-border bg-caution-soft px-5 py-2 text-sm font-semibold text-danger disabled:opacity-50"
        >
          {signingOut ? "ログアウトしています…" : "ログアウトする"}
        </button>
      </section>
    </div>
  );
}
