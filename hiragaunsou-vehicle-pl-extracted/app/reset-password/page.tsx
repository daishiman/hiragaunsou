import { redirect } from "next/navigation";

/**
 * パスワードリセット(メール経由の「パスワードを忘れた方」)機能は不採用となった
 * (Cloudflare Email Serviceが検証済み送信先以外にはWorkers Paidプラン必須と判明したため、
 * 無料枠の範囲で完結させる方針に変更)。
 * メール/パスワードアカウントの発行は、管理者が /admin/users で直接初期パスワードを設定・
 * 画面表示する方式に変更されたため、このルートは使用しない。
 */
export default function ResetPasswordPage() {
  redirect("/sign-in");
}
