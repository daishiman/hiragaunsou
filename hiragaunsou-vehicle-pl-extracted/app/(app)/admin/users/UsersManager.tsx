"use client";

import { useState } from "react";
import type { UserSummary } from "../../../../src/domain/repositories/UserRepository";
import type {
  Invitation,
  InvitationAuthMethod,
} from "../../../../src/domain/repositories/InvitationRepository";
import type { Role } from "../../../../src/domain/rules/permissions";
import { ConfirmDialog } from "../../../_components/ConfirmDialog";

const ROLE_LABELS: Record<Role, string> = {
  admin: "管理者",
  input_staff: "入力担当",
  executive: "経営層",
};

const ROLES: readonly Role[] = ["admin", "input_staff", "executive"];

const AUTH_METHOD_LABELS: Record<InvitationAuthMethod, string> = {
  google: "Google",
  password: "メール/パスワード",
};

type RowState = { status: "idle" } | { status: "saving" } | { status: "error"; message: string };

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function UsersManager({
  initialUsers,
  initialInvitations,
  currentUserId,
}: {
  initialUsers: UserSummary[];
  initialInvitations: Invitation[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  /** 削除の確認待ちユーザー。誰を消すのかを名前で見せてから確定させる。 */
  const [pendingDelete, setPendingDelete] = useState<UserSummary | null>(null);

  const [invitations, setInvitations] = useState(
    initialInvitations.filter((inv) => !inv.revoked && !inv.acceptedAt),
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("input_staff");
  const [inviteAuthMethod, setInviteAuthMethod] = useState<InvitationAuthMethod>("google");
  const [inviteInitialPassword, setInviteInitialPassword] = useState("");
  const [inviteState, setInviteState] = useState<RowState>({ status: "idle" });
  const [invitationRowState, setInvitationRowState] = useState<Record<string, RowState>>({});
  const [provisionedAccount, setProvisionedAccount] = useState<{ email: string; password: string } | null>(
    null,
  );

  async function patchUser(userId: string, patch: { role?: Role; banned?: boolean }) {
    setRowState((prev) => ({ ...prev, [userId]: { status: "saving" } }));
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, ...patch }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setRowState((prev) => ({
          ...prev,
          [userId]: { status: "error", message: data?.error ?? "更新に失敗しました" },
        }));
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...patch } : u)));
      setRowState((prev) => ({ ...prev, [userId]: { status: "idle" } }));
    } catch {
      setRowState((prev) => ({ ...prev, [userId]: { status: "error", message: "通信エラーが発生しました" } }));
    }
  }

  async function deleteUser(userId: string) {
    setPendingDelete(null);
    setRowState((prev) => ({ ...prev, [userId]: { status: "saving" } }));
    try {
      const res = await fetch(`/api/admin/users?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setRowState((prev) => ({
          ...prev,
          [userId]: { status: "error", message: data?.error ?? "削除に失敗しました" },
        }));
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      setRowState((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    } catch {
      setRowState((prev) => ({ ...prev, [userId]: { status: "error", message: "通信エラーが発生しました" } }));
    }
  }

  async function createInvitation(e: React.FormEvent) {
    e.preventDefault();
    if (inviteAuthMethod === "password" && inviteInitialPassword.length < 8) {
      setInviteState({ status: "error", message: "初期パスワードは8文字以上で入力してください" });
      return;
    }
    setInviteState({ status: "saving" });
    setProvisionedAccount(null);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          authMethod: inviteAuthMethod,
          ...(inviteAuthMethod === "password" ? { initialPassword: inviteInitialPassword } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setInviteState({ status: "error", message: data?.error ?? "招待の作成に失敗しました" });
        return;
      }
      const listRes = await fetch("/api/admin/invitations");
      const listData = (await listRes.json().catch(() => null)) as { invitations?: Invitation[] } | null;
      if (listRes.ok && listData?.invitations) {
        setInvitations(listData.invitations.filter((inv) => !inv.revoked && !inv.acceptedAt));
      }
      if (inviteAuthMethod === "password") {
        setProvisionedAccount({ email: inviteEmail.trim().toLowerCase(), password: inviteInitialPassword });
      }
      setInviteEmail("");
      setInviteRole("input_staff");
      setInviteInitialPassword("");
      setInviteState({ status: "idle" });
    } catch {
      setInviteState({ status: "error", message: "通信エラーが発生しました" });
    }
  }

  /**
   * まだ本人が一度もサインインしていない(未受諾の)メール/パスワード招待の「再発行」。
   * 実際の再作成はフォームへ値を差し戻し、管理者が新しい初期パスワードを入力して
   * 再送信することで行う(usecase側で、未受諾のpassword招待に限り古いユーザー行を
   * 削除してから作り直す)。
   */
  function prefillForReissue(inv: Invitation) {
    setInviteEmail(inv.email);
    setInviteRole(inv.role);
    setInviteAuthMethod("password");
    setInviteInitialPassword("");
    setProvisionedAccount(null);
    setInviteState({ status: "idle" });
  }

  async function revokeInvitation(id: string) {
    setInvitationRowState((prev) => ({ ...prev, [id]: { status: "saving" } }));
    try {
      const res = await fetch(`/api/admin/invitations?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setInvitationRowState((prev) => ({
          ...prev,
          [id]: { status: "error", message: data?.error ?? "取消に失敗しました" },
        }));
        return;
      }
      setInvitations((prev) => prev.filter((inv) => inv.id !== id));
    } catch {
      setInvitationRowState((prev) => ({
        ...prev,
        [id]: { status: "error", message: "通信エラーが発生しました" },
      }));
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="overflow-x-auto">
          <table className="data-table min-w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th className="py-2 pr-3">氏名</th>
                <th className="py-2 pr-3">メールアドレス</th>
                <th className="py-2 pr-3">ロール</th>
                <th className="py-2 pr-3">状態</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const state = rowState[u.id] ?? { status: "idle" };
                const isSelf = u.id === currentUserId;
                const saving = state.status === "saving";
                return (
                  <tr key={u.id} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3">
                      {u.name}
                      {isSelf ? <span className="ml-1 text-[11px] text-ink-muted">(自分)</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{u.email}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={u.role}
                        disabled={saving || (isSelf && u.role === "admin")}
                        onChange={(e) => void patchUser(u.id, { role: e.target.value as Role })}
                        className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      {u.banned ? (
                        <span className="rounded-full bg-caution-soft px-2 py-0.5 text-[11px] font-semibold text-danger">
                          凍結中
                        </span>
                      ) : (
                        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-deep">
                          有効
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={saving || isSelf}
                          onClick={() => void patchUser(u.id, { banned: !u.banned })}
                          className={[
                            "btn btn-sm pressable",
                            u.banned ? "btn-secondary" : "btn-danger",
                          ].join(" ")}
                        >
                          {u.banned ? "このユーザーの凍結を解除する" : "このユーザーを凍結する"}
                        </button>
                        <button
                          type="button"
                          disabled={saving || isSelf}
                          onClick={() => setPendingDelete(u)}
                          className="btn btn-danger btn-sm pressable"
                        >
                          このユーザーを削除する
                        </button>
                      </div>
                      {state.status === "error" ? (
                        <p className="mt-1 text-[11px] text-danger">{state.message}</p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">新しいユーザーを招待する</h2>
        <p className="mt-1 text-xs text-ink-muted">
          「Google」を選ぶと、招待したメールアドレスでGoogleサインインした時点で指定ロールが自動付与されます。
          「メール/パスワード」を選ぶと、ここで入力した初期パスワードでその場にアカウントが作成されます
          (Gmailを持たない社内ユーザー向け。メールの自動送信は行わないため、
          発行後に表示されるメールアドレスと初期パスワードを社内チャット等で本人へお伝えください)。
        </p>
        <form onSubmit={(e) => void createInvitation(e)} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            メールアドレス
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="taro@example.com"
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            ロール
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            サインイン方法
            <select
              value={inviteAuthMethod}
              onChange={(e) => setInviteAuthMethod(e.target.value as InvitationAuthMethod)}
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            >
              <option value="google">Google</option>
              <option value="password">メール/パスワード</option>
            </select>
          </label>
          {inviteAuthMethod === "password" ? (
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              初期パスワード(8文字以上)
              <input
                type="text"
                required
                minLength={8}
                value={inviteInitialPassword}
                onChange={(e) => setInviteInitialPassword(e.target.value)}
                placeholder="本人へ伝える初期パスワード"
                className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
          ) : null}
          <button
            type="submit"
            disabled={inviteState.status === "saving"}
            className="btn btn-secondary btn-sm pressable"
          >
            招待する
          </button>
        </form>
        {inviteState.status === "error" ? (
          <p className="mt-2 text-[11px] text-danger">{inviteState.message}</p>
        ) : null}
        {provisionedAccount ? (
          <div className="mt-3 rounded-md border border-brand bg-brand-soft px-4 py-3 text-xs text-brand-deep">
            <p className="font-semibold">アカウントを作成しました。</p>
            <p className="mt-1">メールアドレス: {provisionedAccount.email}</p>
            <p className="mt-1">初期パスワード: {provisionedAccount.password}</p>
            <p className="mt-1 text-[11px]">
              この画面はこの後リロードすると表示されなくなります。社内チャット等の安全な経路で本人へ共有してください
              (メールでの自動送信は行いません)。
            </p>
          </div>
        ) : null}

        {invitations.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="data-table min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3">メールアドレス</th>
                  <th className="py-2 pr-3">ロール</th>
                  <th className="py-2 pr-3">サインイン方法</th>
                  <th className="py-2 pr-3">招待者</th>
                  <th className="py-2 pr-3">招待日</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const state = invitationRowState[inv.id] ?? { status: "idle" };
                  return (
                    <tr key={inv.id} className="border-b border-line last:border-b-0">
                      <td className="py-2 pr-3">{inv.email}</td>
                      <td className="py-2 pr-3">{ROLE_LABELS[inv.role]}</td>
                      <td className="py-2 pr-3 text-ink-muted">{AUTH_METHOD_LABELS[inv.authMethod]}</td>
                      <td className="py-2 pr-3 text-ink-muted">{inv.invitedByName ?? "-"}</td>
                      <td className="py-2 pr-3 text-ink-muted">{formatDate(inv.createdAt)}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          {inv.authMethod === "password" ? (
                            <button
                              type="button"
                              disabled={state.status === "saving"}
                              onClick={() => prefillForReissue(inv)}
                              className="btn btn-secondary btn-sm pressable"
                            >
                              初期パスワードを再発行
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={state.status === "saving"}
                            onClick={() => void revokeInvitation(inv.id)}
                            className="btn btn-quiet btn-sm pressable"
                          >
                            この招待を取り消す
                          </button>
                        </div>
                        {state.status === "error" ? (
                          <p className="mt-1 text-[11px] text-danger">{state.message}</p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-muted">招待中(未サインイン)のユーザーはいません。</p>
        )}
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="このユーザーを削除します。よろしいですか?(取り消せません)"
        confirmLabel="削除する"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void deleteUser(pendingDelete.id);
        }}
      >
        {pendingDelete ? (
          <p>
            {pendingDelete.name || pendingDelete.email}({pendingDelete.email})
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
