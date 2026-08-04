import { redirect } from "next/navigation";
import { getServerSession } from "../../src/infrastructure/auth/session";
import { SignInButton } from "./SignInButton";
import { signInErrorMessage } from "./signInErrorMessage";

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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 py-10">
      <section className="w-full rounded-xl border border-line bg-white p-8 text-center">
        <h1 className="text-sm font-bold text-ink">車両別収支表</h1>
        <p className="mt-1 text-xs text-ink-muted">平賀運送 — 月次車両別P&amp;L自動化</p>

        {errorMessage ? (
          <p
            role="alert"
            className="mt-6 rounded-md border border-danger bg-subtle px-4 py-3 text-left text-sm text-danger"
          >
            {errorMessage}
          </p>
        ) : null}

        <p className="mt-6 text-sm text-ink-muted">
          社内アカウント(Google Workspace)でサインインしてください。
        </p>
        <div className="mt-6">
          <SignInButton />
        </div>
      </section>
    </main>
  );
}
