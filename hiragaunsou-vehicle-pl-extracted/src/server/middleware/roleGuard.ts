import type { Context, Next } from "hono";
import { createAuth } from "../auth";
import type { AppEnv } from "../hono-env";

/**
 * 権限マトリクス (docs/requirement.md 4章) を実装するロールガード。
 *   admin(今西)      : 閲覧/入力/承認/マスタ編集/締め確定/レポート配信設定 すべて可
 *   input_staff(山本): 閲覧/入力/承認/マスタ編集 可。締め確定は申請のみ(このスライスでは未実装)
 *   executive(社長)  : 閲覧・レポート配信設定のみ (入力/承認/マスタ編集不可)
 *
 * 給与等の個人別報酬データを含むため、ロール外への画面露出は不可 (要件定義4章)。
 */
export type Role = "admin" | "input_staff" | "executive";

export type Permission =
  | "view"
  | "input"
  | "approve_anomaly"
  | "edit_master"
  | "confirm_close"
  | "report_settings";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    "view",
    "input",
    "approve_anomaly",
    "edit_master",
    "confirm_close",
    "report_settings",
  ],
  input_staff: ["view", "input", "approve_anomaly", "edit_master"],
  executive: ["view", "report_settings"],
};

export function hasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as Role];
  return perms ? perms.includes(permission) : false;
}

/**
 * セッション検証ミドルウェア。ルート保護はCookieの存在だけで完結させず、
 * `auth.api.getSession` で毎回検証する (better-auth-google-gate スキルの不変条件)。
 */
export function requireSession() {
  return async (c: Context<AppEnv>, next: Next) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session || !session.user.emailVerified) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("session", session);
    return next();
  };
}

export function requirePermission(permission: Permission) {
  return async (c: Context<AppEnv>, next: Next) => {
    const session = c.get("session");
    const role =
      (session?.user as { role?: string } | undefined)?.role ?? "input_staff";
    if (!hasPermission(role, permission)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    return next();
  };
}
