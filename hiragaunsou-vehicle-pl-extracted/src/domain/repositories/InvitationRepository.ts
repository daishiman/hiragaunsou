import type { Role } from "../rules/permissions";

/**
 * ユーザー招待(仮登録)。認証方式は2通り。
 *
 * - "google": better-auth-googleはGoogle OAuthのみでログインするため、パスワード付き招待リンクのような
 *   「トークンを踏むとログインできる」仕組みは持てない(Googleアカウントでの認証をバイパスできない)。
 *   「このメールアドレスにはこのロールを割り当てる」という予約を管理者が事前に作成しておき、
 *   本人が実際にGoogle Workspaceアカウントで初めてサインインした瞬間(auth.tsのuser.create.beforeフック)に
 *   予約されたロールを適用する。これにより「DBへ直接ロールをUPDATEする」運用を無くせる。
 *   ログイン自体の許可・拒否は既存のWORKSPACE_DOMAINS(hd claim検証)がそのまま担う。
 * - "password": Gmailを持たない社内ユーザー向け。招待作成と同時にuser行を作成し、
 *   better-authの標準パスワードリセット機構(requestPasswordReset/resetPassword)を使って
 *   初期パスワード設定リンクを発行する(自己登録フォームは作らない。初期パスワードの受け渡し経路も
 *   作らない — 本人が自分でパスワードを設定するリンクを、管理者が安全な経路で一度だけ手渡しする)。
 */
export type InvitationAuthMethod = "google" | "password";

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  invitedByName: string | null;
  createdAt: number;
  acceptedAt: number | null;
  revoked: boolean;
  authMethod: InvitationAuthMethod;
}

export interface CreateInvitationInput {
  email: string;
  role: Role;
  invitedBy: string;
  authMethod: InvitationAuthMethod;
}

export interface InvitationRepository {
  list(): Promise<Invitation[]>;
  findPendingByEmail(email: string): Promise<Invitation | null>;
  /** 同じメールへの招待が既にあれば置き換える(常に最新のロールで上書き)。 */
  upsert(input: CreateInvitationInput): Promise<void>;
  revoke(id: string): Promise<void>;
  markAccepted(email: string): Promise<void>;
}
