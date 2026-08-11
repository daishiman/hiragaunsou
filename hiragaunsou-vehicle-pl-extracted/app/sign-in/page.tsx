import { redirect } from "next/navigation";
import { getServerSession } from "../../src/infrastructure/auth/session";
import { SignInButton } from "./SignInButton";
import { PasswordSignInForm } from "./PasswordSignInForm";
import { signInErrorMessage } from "./signInErrorMessage";
import { AuthShell } from "../_components/AuthShell";
import { AlertPanel } from "../_components/AlertPanel";
import { SectionHeading } from "../_components/SectionHeading";
import { Prose } from "../_components/Card";

/** S: サインイン画面。Google Workspace限定ログイン(better-auth-google-gate)。 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getServerSession();
  if (session) redirect("/");

  // OAuthコールバックが失敗すると Better Auth が /sign-in?error=<code> に戻す
  // (auth.ts の onAPIError.errorURL)。理由を出さないと「同じ画面に戻るだけ」に見えてしまう。
  const { error } = await searchParams;
  const errorMessage = signInErrorMessage(error);

  /*
    この画面はアプリの枠(AppShell)の外にあるため、枠組みは AuthShell に揃える
    (アプリ内と同じフッターを出す。「同じアプリだ」の合図は枠が同じであること)。
    表かカードかの判定 (T7 §4-1): 見比べる値が1つも無いので表は使わない。
  */
  return (
    <AuthShell>
      <section className="w-full card p-8 text-center">
        <h1 className="text-sm font-bold text-ink">車両別収支表</h1>
        <p className="mt-1 text-xs text-ink-muted">平賀運送 — 月次車両別P&amp;L自動化</p>

        {errorMessage ? (
          <div className="mt-6 text-left">
            <AlertPanel tone="danger" title="サインインできませんでした">
              {errorMessage}
            </AlertPanel>
          </div>
        ) : null}

        <p className="mt-6 text-sm text-ink-muted">
          社内アカウント（Google Workspace）でサインインしてください。
        </p>
        <div className="mt-6">
          <SignInButton />
        </div>

        <SectionHeading className="text-left">Gmailをお持ちでない方</SectionHeading>
        <div className="mt-4">
          <PasswordSignInForm />
        </div>
        <Prose className="mt-3">
          パスワードを未設定・お忘れの場合は、管理者から届いた初期設定リンクをご利用いただくか、管理者にお問い合わせください。
        </Prose>
      </section>
    </AuthShell>
  );
}
