import type { Role } from "../rules/permissions";

/**
 * ユーザー管理(自分のプロフィール確認・編集、管理者による全ユーザー管理)で使う型と
 * リポジトリインターフェース。認証そのもの(セッション発行等)は better-auth (auth.ts) の
 * 責務であり、このリポジトリは user テーブルの参照・更新のみを扱う。
 */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  createdAt: number;
}

export interface UserRepository {
  list(): Promise<UserSummary[]>;
  findById(id: string): Promise<UserSummary | null>;
  /** 管理者による更新。role・banned のどちらか一方だけの変更も可能(未指定フィールドは変更しない)。 */
  updateRoleAndBanned(id: string, input: { role?: Role; banned?: boolean }): Promise<void>;
  /** 本人による氏名変更。 */
  updateName(id: string, name: string): Promise<void>;
  /** 対象ユーザーの全セッションを失効させる(凍結時に即ログアウトさせるため)。 */
  deleteSessions(userId: string): Promise<void>;
  /**
   * ユーザーを完全に削除する(session/accountはFK cascadeで一緒に消える)。
   * 取込履歴・AI設定更新者等の監査系テーブルから参照されている場合はFK制約違反で失敗する
   * (呼び出し側usecaseで「凍結をご利用ください」等の分かりやすいメッセージへ変換すること)。
   */
  deleteUser(id: string): Promise<void>;
  findByEmail(email: string): Promise<UserSummary | null>;
}
