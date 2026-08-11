import type { UserRepository, UserSummary } from "../../domain/repositories/UserRepository";
import { type Role } from "../../domain/rules/permissions";

const VALID_ROLES: readonly Role[] = ["admin", "input_staff", "executive"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (VALID_ROLES as readonly string[]).includes(value);
}

/** 管理者による全ユーザー一覧取得(/admin/users 画面)。 */
export class ListUsersUseCase {
  constructor(private readonly repo: UserRepository) {}

  async execute(): Promise<UserSummary[]> {
    return this.repo.list();
  }
}

export interface UpdateUserByAdminInput {
  actorId: string;
  targetUserId: string;
  role?: Role;
  banned?: boolean;
}

/**
 * 管理者による対象ユーザーのロール変更・凍結/解除。
 * 自分自身を凍結したり、自分自身から admin ロールを外して管理者不在にする操作は拒否する
 * (要件定義の権限モデルを壊さないための最低限のガード)。
 */
export class UpdateUserByAdminUseCase {
  constructor(private readonly repo: UserRepository) {}

  async execute(input: UpdateUserByAdminInput): Promise<void> {
    if (input.targetUserId === input.actorId) {
      if (input.banned === true) {
        throw new Error("自分自身を凍結することはできません");
      }
      if (input.role !== undefined && input.role !== "admin") {
        throw new Error("自分自身から管理者ロールを外すことはできません");
      }
    }

    const target = await this.repo.findById(input.targetUserId);
    if (!target) {
      throw new Error("対象の利用者が見つかりません");
    }

    await this.repo.updateRoleAndBanned(input.targetUserId, {
      role: input.role,
      banned: input.banned,
    });

    // 凍結時は即座にログイン状態を解除する(既存Cookieが残っていても再認証させる)。
    if (input.banned === true) {
      await this.repo.deleteSessions(input.targetUserId);
    }
  }
}

/** 本人によるプロフィール更新(氏名のみ。メール・ロールは本人からは変更不可)。 */
export class UpdateOwnProfileUseCase {
  constructor(private readonly repo: UserRepository) {}

  async execute(userId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error("氏名を入力してください");
    }
    if (trimmed.length > 100) {
      throw new Error("氏名が長すぎます");
    }
    await this.repo.updateName(userId, trimmed);
  }
}

/**
 * 管理者によるユーザー削除。
 * 自分自身は削除できない。取込履歴・AI設定更新者等の監査系テーブルから参照されている
 * ユーザーはFK制約違反で削除できないため、その場合は「凍結」を使うよう案内する。
 */
export class DeleteUserByAdminUseCase {
  constructor(private readonly repo: UserRepository) {}

  async execute(input: { actorId: string; targetUserId: string }): Promise<void> {
    if (input.targetUserId === input.actorId) {
      throw new Error("自分自身を削除することはできません");
    }
    const target = await this.repo.findById(input.targetUserId);
    if (!target) {
      throw new Error("対象の利用者が見つかりません");
    }
    try {
      await this.repo.deleteUser(input.targetUserId);
    } catch {
      throw new Error(
        "この利用者は操作履歴(データ取込・AI設定変更等)があるため削除できません。ログインを止めたい場合は「凍結する」をご利用ください。",
      );
    }
  }
}
