/**
 * 権限マトリクス (docs/requirement.md 4章)。
 *   admin(今西)      : 閲覧/入力/承認/マスタ編集/締め確定/レポート配信設定 すべて可
 *   input_staff(山本): 閲覧/入力/承認/マスタ編集 可。締め確定は申請のみ(このスライスでは未実装)
 *   executive(社長)  : 閲覧・レポート配信設定のみ (入力/承認/マスタ編集不可)
 *
 * 給与等の個人別報酬データを含むため、ロール外への画面露出は不可 (要件定義4章)。
 * フレームワーク非依存の純粋ルールとして Domain 層に置く。
 */
export type Role = "admin" | "input_staff" | "executive";

export type Permission =
  | "view"
  | "input"
  | "approve_anomaly"
  | "edit_master"
  | "confirm_close"
  | "report_settings"
  | "manage_api_keys"
  | "manage_users"
  | "manage_imports"
  /**
   * 届いた改善要望を読む・対応状況を書き換える。
   * 他の人が書いた不満がそのまま載るため、入力担当・経営には開かない
   * (依頼者の指示: 最上位の管理者だけが一元管理する)。
   */
  | "manage_improvements";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "view",
    "input",
    "approve_anomaly",
    "edit_master",
    "confirm_close",
    "report_settings",
    "manage_api_keys",
    "manage_users",
    "manage_imports",
    "manage_improvements",
  ],
  input_staff: ["view", "input", "approve_anomaly", "edit_master"],
  executive: ["view", "report_settings"],
};

export function hasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as Role];
  return perms ? perms.includes(permission) : false;
}
