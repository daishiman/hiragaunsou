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
  | "manage_imports";

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
  ],
  input_staff: ["view", "input", "approve_anomaly", "edit_master"],
  executive: ["view", "report_settings"],
};

export function hasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as Role];
  return perms ? perms.includes(permission) : false;
}
