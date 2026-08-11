"use client";

import { useState } from "react";
import type { UserSummary } from "../../../../src/domain/repositories/UserRepository";
import type {
  Invitation,
  InvitationAuthMethod,
} from "../../../../src/domain/repositories/InvitationRepository";
import type { Role } from "../../../../src/domain/rules/permissions";
import { ConfirmDialog } from "../../../_components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../../_components/DataTable";
import { StickyFilterBar } from "../../../_components/StickyFilterBar";
import { SectionHeading } from "../../../_components/SectionHeading";
import { Badge } from "../../../_components/Badge";
import { AlertPanel } from "../../../_components/AlertPanel";
import { Prose } from "../../../_components/Card";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "../../../_components/formStyles";

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

/**
 * 利用者の管理。
 *
 * ■ 表か否か（T7 §4-1 の質問への答え）
 * ここでやりたいのは「誰がどのロールで、いま使える状態か」を行をまたいで見比べ、
 * 違っている行だけを直すことなので、器は表（DataTable）のままでよい。
 * 1件を読んで判断する画面ではないため定義リストには替えない。
 *
 * ■ 言葉
 * このアプリを使う人の呼び方は「利用者」に統一する（T7 §1-1）。数える単位は「名」。
 * 画面名（サイドバー・アカウントメニューに出る「ユーザー管理」）は app/_lib/screens.ts が
 * 持っているのでここでは触らない。
 */
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
  /** 削除の確認待ちの利用者。誰を削除するのかを名前で見せてから確定させる。 */
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
   * 再送信することで行う(usecase側で、未受諾のpassword招待に限り古い行を
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
          [id]: { status: "error", message: data?.error ?? "取り消しに失敗しました" },
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

  const bannedCount = users.filter((u) => u.banned).length;

  const userColumns: DataTableColumn<UserSummary>[] = [
    {
      key: "name",
      header: "氏名",
      cell: (u) => (
        <>
          {u.name}
          {u.id === currentUserId ? (
            <span className="ml-1 text-[11px] text-ink-muted">（自分）</span>
          ) : null}
        </>
      ),
    },
    {
      key: "email",
      header: "メールアドレス",
      cellClassName: "wrap text-ink-muted",
      cell: (u) => u.email,
    },
    {
      key: "role",
      header: "ロール",
      cell: (u) => {
        const state = rowState[u.id] ?? { status: "idle" };
        const isSelf = u.id === currentUserId;
        return (
          <select
            value={u.role}
            aria-label={`${u.name || u.email}のロール`}
            disabled={state.status === "saving" || (isSelf && u.role === "admin")}
            onChange={(e) => void patchUser(u.id, { role: e.target.value as Role })}
            className={FIELD_CLASS}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: "status",
      header: "状態",
      cell: (u) =>
        u.banned ? <Badge tone="danger">凍結中</Badge> : <Badge tone="brand">有効</Badge>,
    },
    {
      key: "actions",
      header: "できること",
      cell: (u) => {
        const state = rowState[u.id] ?? { status: "idle" };
        const isSelf = u.id === currentUserId;
        const saving = state.status === "saving";
        return (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || isSelf}
                onClick={() => void patchUser(u.id, { banned: !u.banned })}
                className={["btn btn-sm pressable", u.banned ? "btn-secondary" : "btn-danger"].join(" ")}
              >
                {u.banned ? "この利用者の凍結を解除する" : "この利用者を凍結する"}
              </button>
              <button
                type="button"
                disabled={saving || isSelf}
                onClick={() => setPendingDelete(u)}
                className="btn btn-danger btn-sm pressable"
              >
                この利用者を削除する
              </button>
            </div>
            {isSelf ? (
              <p className="mt-1 text-[11px] text-ink-muted">
                自分自身は凍結・削除できません。別の管理者にご依頼ください。
              </p>
            ) : null}
            {state.status === "error" ? (
              <p className="mt-1 text-[11px] text-danger">{state.message}</p>
            ) : null}
          </>
        );
      },
    },
  ];

  const invitationColumns: DataTableColumn<Invitation>[] = [
    {
      key: "email",
      header: "メールアドレス",
      cellClassName: "wrap",
      cell: (inv) => inv.email,
    },
    { key: "role", header: "ロール", cell: (inv) => ROLE_LABELS[inv.role] },
    {
      key: "authMethod",
      header: "サインイン方法",
      cellClassName: "text-ink-muted",
      cell: (inv) => AUTH_METHOD_LABELS[inv.authMethod],
    },
    {
      key: "invitedBy",
      header: "招待した人",
      priority: "low",
      cellClassName: "text-ink-muted",
      cell: (inv) => inv.invitedByName ?? "—",
    },
    {
      key: "createdAt",
      header: "招待した日",
      priority: "low",
      cellClassName: "whitespace-nowrap text-ink-muted",
      cell: (inv) => formatDate(inv.createdAt),
    },
    {
      key: "actions",
      header: "できること",
      cell: (inv) => {
        const state = invitationRowState[inv.id] ?? { status: "idle" };
        return (
          <>
            <div className="flex flex-wrap gap-2">
              {inv.authMethod === "password" ? (
                <button
                  type="button"
                  disabled={state.status === "saving"}
                  onClick={() => prefillForReissue(inv)}
                  className="btn btn-secondary btn-sm pressable"
                >
                  初期パスワードを再発行する
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
          </>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* 何名を見ているか・そのうち何名が凍結中かは、下までスクロールしても要る（T7 §2-3）。 */}
      <StickyFilterBar
        summary={`登録${users.length}名（うち凍結中${bannedCount}名）／招待中${invitations.length}名`}
      >
        <span className="text-xs font-semibold text-ink">登録済みの利用者と招待中の利用者</span>
      </StickyFilterBar>

      <section className="card p-5">
        <SectionHeading divider={false} action={`${users.length}名`}>
          登録済みの利用者
        </SectionHeading>
        <div className="mt-3">
          <DataTable
            caption="登録済みの利用者。氏名・メールアドレス・ロール・状態を見比べる。"
            columns={userColumns}
            rows={users}
            rowKey={(u) => u.id}
            maxHeight="28rem"
            empty={
              <p className="rounded-lg bg-subtle px-4 py-3 text-sm text-ink-muted">
                登録済みの利用者がいません。下の「新しい利用者を招待する」からメールアドレスを
                登録してください。
              </p>
            }
          />
        </div>
      </section>

      <section className="card p-5">
        <SectionHeading divider={false}>新しい利用者を招待する</SectionHeading>
        <Prose className="mt-1">
          「Google」を選ぶと、招待したメールアドレスでGoogleサインインした時点で指定ロールが自動付与されます。
          「メール/パスワード」を選ぶと、ここで入力した初期パスワードでその場にアカウントが作成されます
          （Gmailを持たない社内の方向け。メールの自動送信は行わないため、
          発行後に表示されるメールアドレスと初期パスワードを社内チャット等で本人へお伝えください）。
        </Prose>
        <form onSubmit={(e) => void createInvitation(e)} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>メールアドレス</span>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="taro@example.com"
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>ロール</span>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className={FIELD_CLASS}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>サインイン方法</span>
            <select
              value={inviteAuthMethod}
              onChange={(e) => setInviteAuthMethod(e.target.value as InvitationAuthMethod)}
              className={FIELD_CLASS}
            >
              <option value="google">Google</option>
              <option value="password">メール/パスワード</option>
            </select>
          </label>
          {inviteAuthMethod === "password" ? (
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>初期パスワード（8文字以上）</span>
              <input
                type="text"
                required
                minLength={8}
                value={inviteInitialPassword}
                onChange={(e) => setInviteInitialPassword(e.target.value)}
                placeholder="本人へ伝える初期パスワード"
                className={FIELD_CLASS}
              />
            </label>
          ) : null}
          <button
            type="submit"
            disabled={inviteState.status === "saving"}
            className="btn btn-secondary btn-sm pressable"
          >
            この利用者を招待する
          </button>
        </form>
        {inviteState.status === "error" ? (
          <div className="mt-3">
            <AlertPanel tone="danger" title="招待できませんでした">
              <p>{inviteState.message}</p>
            </AlertPanel>
          </div>
        ) : null}
        {provisionedAccount ? (
          <div className="mt-3">
            <AlertPanel tone="success" title="アカウントを作成しました。">
              <p>メールアドレス: {provisionedAccount.email}</p>
              <p className="mt-1">初期パスワード: {provisionedAccount.password}</p>
              <p className="mt-1">
                この画面はこの後リロードすると表示されなくなります。社内チャット等の安全な経路で
                本人へ共有してください（メールでの自動送信は行いません）。
              </p>
            </AlertPanel>
          </div>
        ) : null}

        <div className="mt-5">
          <SectionHeading divider={false} action={`${invitations.length}名`}>
            招待中の利用者
          </SectionHeading>
          <div className="mt-3">
            <DataTable
              caption="招待中（まだ一度もサインインしていない）の利用者。"
              columns={invitationColumns}
              rows={invitations}
              rowKey={(inv) => inv.id}
              maxHeight="24rem"
              empty={
                <p className="rounded-lg bg-subtle px-4 py-3 text-xs text-ink-muted">
                  招待中（未サインイン）の利用者はいません。新しく使う方がいる場合は、
                  上のフォームからメールアドレスを登録してください。
                </p>
              }
            />
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="この利用者を削除します。よろしいですか？（取り消せません）"
        confirmLabel="削除する"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void deleteUser(pendingDelete.id);
        }}
      >
        {pendingDelete ? (
          <p>
            {pendingDelete.name || pendingDelete.email}（{pendingDelete.email}）
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
