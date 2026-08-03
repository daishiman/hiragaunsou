import { hasPermission, type Permission } from "../../domain/rules/permissions";
import type { SessionUser } from "./session";

/**
 * Route Handler の認証ガードを1箇所にまとめた薄いヘルパー。
 * 「未ログイン(session===null)」と「ログイン済みだが権限不足」を区別せず、
 * どちらも同じ401として扱う(要件定義4章: ロール外への画面露出は不可)。
 */
export function checkAccess(session: SessionUser | null, permission: Permission): boolean {
  if (!session) return false;
  return hasPermission(session.role, permission);
}
