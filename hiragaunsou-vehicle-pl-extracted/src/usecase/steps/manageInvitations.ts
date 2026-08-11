import type {
  InvitationRepository,
  Invitation,
  InvitationAuthMethod,
} from "../../domain/repositories/InvitationRepository";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import type { Role } from "../../domain/rules/permissions";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 管理者による招待一覧取得(/admin/users 画面)。 */
export class ListInvitationsUseCase {
  constructor(private readonly repo: InvitationRepository) {}

  async execute(): Promise<Invitation[]> {
    return this.repo.list();
  }
}

export interface CreateInvitationInput {
  invitedBy: string;
  email: string;
  role: Role;
  /** "google"(既定): Googleサインインを待つ。 "password": 管理者が初期パスワードを直接設定する。 */
  authMethod: InvitationAuthMethod;
  /**
   * authMethod="password" の場合必須。管理者が画面上で直接入力した初期パスワード
   * (8文字以上、実際の強度検証はbetter-auth標準機構に委ねる)。
   * メールでの送信は行わず、管理者が口頭・社内チャット等の別経路で本人へ伝える運用とする。
   */
  initialPassword?: string;
}

export interface CreateInvitationResult {
  /**
   * authMethod="password"の場合true。呼び出し側(APIルート)がbetter-authの
   * internalInviteProvisioning経由のsignUpEmailで実アカウント(user+credential)を、
   * 管理者が指定した初期パスワードで作成する必要がある。
   * falseなら(google招待)アカウント作成は不要(本人の初回Googleサインインを待つ)。
   */
  needsAccountProvisioning: boolean;
}

/**
 * 管理者によるユーザー招待の作成。
 *
 * authMethod="google" の場合: 「DBへ直接ユーザー行をINSERTする」運用を無くすのが目的のため、
 * ここでは user テーブルへは一切書き込まない。実際の user 行は本人が初めてGoogleでサインインした時に
 * 作られる (src/infrastructure/auth/auth.ts の user.create.before フックが、この招待からロールを引き継ぐ)。
 *
 * authMethod="password" の場合: メール送信基盤を持たないため、招待リンク経由の自己設定は行わない。
 * 代わりに管理者がこの画面で直接入力した初期パスワードで、その場でアカウント(user+credential)を
 * 作成する。既に同じメールアドレスの「未使用(password招待がまだ残っている)」アカウントが
 * 存在する場合は、それを削除してから新しい初期パスワードで作り直す(=事実上の「再発行」)。
 * 既にGoogle等で実際に使われている(招待が受諾済みの)アカウントへは絶対に上書きしない。
 */
export class CreateInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(input: CreateInvitationInput): Promise<CreateInvitationResult> {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throw new Error("メールアドレスの形式が正しくありません");
    }
    const existingUser = await this.users.findByEmail(email);

    if (input.authMethod === "password") {
      if (!input.initialPassword || input.initialPassword.length < 8) {
        throw new Error("初期パスワードは8文字以上で入力してください");
      }
      if (existingUser) {
        const pending = await this.invitations.findPendingByEmail(email);
        if (!pending || pending.authMethod !== "password") {
          throw new Error("このメールアドレスは既に利用者として登録されています。利用者の一覧から編集してください。");
        }
        // まだ一度もサインインされていない(=招待が未受諾)password招待のみ、作り直しを許可する。
        await this.users.deleteUser(existingUser.id);
      }
      await this.invitations.upsert({ email, role: input.role, invitedBy: input.invitedBy, authMethod: "password" });
      return { needsAccountProvisioning: true };
    }

    if (existingUser) {
      throw new Error("このメールアドレスは既に利用者として登録されています。利用者の一覧から編集してください。");
    }
    await this.invitations.upsert({ email, role: input.role, invitedBy: input.invitedBy, authMethod: "google" });
    return { needsAccountProvisioning: false };
  }
}

/** 管理者による招待の取消(まだ本人がサインインしていない招待のみ意味を持つ)。 */
export class RevokeInvitationUseCase {
  constructor(private readonly repo: InvitationRepository) {}

  async execute(id: string): Promise<void> {
    await this.repo.revoke(id);
  }
}
