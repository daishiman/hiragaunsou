"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { signOut, authClient } from "../../_lib/authClient";
import { AlertPanel } from "../../_components/AlertPanel";
import { Card, Prose } from "../../_components/Card";
import { DefinitionList } from "../../_components/DefinitionList";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "../../_components/formStyles";

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

  /*
    T7 §4-1 の質問への答え。
      この画面で人がやるのは「自分の1件を読んで、必要なら直す」こと。
      利用者どうしを見比べる場面ではないので表は使わず、
      読むだけの値は定義リスト、直せる値は項目名と入力欄を縦に並べる。
  */
  return (
    <div className="flex flex-col gap-6">
      <Card title="アカウント情報">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>氏名</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className={FIELD_CLASS}
            />
          </label>

          <DefinitionList
            items={[
              {
                term: "メールアドレス",
                value: email,
                note: hasPasswordCredential
                  ? undefined
                  : "Googleサインインのアカウントのため、この画面からは変更できません。",
              },
              {
                term: "ロール",
                value: roleLabel,
                note: "ロールの変更は管理者にご依頼ください。",
              },
            ]}
          />

          {/* 失敗は注意(caution)ではなく danger で出す。色は意味にだけ使う。 */}
          {saveState.status === "error" ? (
            <AlertPanel tone="danger" title="保存できませんでした">
              {saveState.message}
            </AlertPanel>
          ) : null}

          <button
            type="button"
            onClick={handleSave}
            disabled={saveState.status === "saving" || name.trim().length === 0}
            className="btn btn-primary pressable self-start"
          >
            {saveState.status === "saving" ? "保存しています…" : "氏名を保存する"}
          </button>
        </div>
      </Card>

      {hasPasswordCredential ? (
        <Card title="メールアドレスの変更">
          <Prose>
            確認メールは送信されません。現在のパスワードを入力すると、その場で変更が反映されます
            （変更後は他のデバイス・タブのログイン状態は失効します）。
          </Prose>
          <form onSubmit={handleChangeEmail} className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>新しいメールアドレス</span>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className={FIELD_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>現在のパスワード（本人確認のため）</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={emailCurrentPassword}
                onChange={(e) => setEmailCurrentPassword(e.target.value)}
                className={FIELD_CLASS}
              />
            </label>
            {emailSaveState.status === "error" ? (
              <AlertPanel tone="danger" title="メールアドレスを変更できませんでした">
                {emailSaveState.message}
              </AlertPanel>
            ) : null}
            {emailSaveState.status === "success" ? (
              <AlertPanel tone="success" title="メールアドレスを変更しました">
                次回からは新しいメールアドレスでサインインしてください。
              </AlertPanel>
            ) : null}
            <button
              type="submit"
              disabled={emailSaveState.status === "saving" || newEmail.trim().length === 0}
              className="btn btn-primary pressable self-start"
            >
              {emailSaveState.status === "saving" ? "保存しています…" : "メールアドレスを保存する"}
            </button>
          </form>
        </Card>
      ) : null}

      {hasPasswordCredential ? (
        <Card title="パスワードの変更">
          <Prose>
            メール／パスワードでサインインしているアカウントのパスワードを変更します。
          </Prose>
          <form onSubmit={handleChangePassword} className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>現在のパスワード</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={FIELD_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>新しいパスワード（8文字以上）</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={FIELD_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>新しいパスワード（確認）</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                className={FIELD_CLASS}
              />
            </label>
            {passwordSaveState.status === "error" ? (
              <AlertPanel tone="danger" title="パスワードを変更できませんでした">
                {passwordSaveState.message}
              </AlertPanel>
            ) : null}
            {passwordSaveState.status === "success" ? (
              <AlertPanel tone="success" title="パスワードを変更しました">
                次回からは新しいパスワードでサインインしてください。
              </AlertPanel>
            ) : null}
            <button
              type="submit"
              disabled={passwordSaveState.status === "saving"}
              className="btn btn-primary pressable self-start"
            >
              {passwordSaveState.status === "saving" ? "保存しています…" : "パスワードを保存する"}
            </button>
          </form>
        </Card>
      ) : null}

      <Card title="ログアウト">
        <Prose>このデバイスでのログイン状態を終了します。</Prose>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="btn btn-danger pressable mt-3 self-start"
        >
          {signingOut ? "ログアウトしています…" : "ログアウトする"}
        </button>
      </Card>
    </div>
  );
}
