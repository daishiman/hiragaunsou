import { redirect } from "next/navigation";
import { getServerSession } from "../../src/infrastructure/auth/session";
import { checkAccess } from "../../src/infrastructure/auth/accessControl";
import { ReportGenerator } from "./ReportGenerator";

/** F12 AI要因分析レポート (S10画面)。生成はadmin/executiveのみ(要件定義4章「レポート配信設定」相当)。 */
export default async function ReportPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "report_settings")) redirect("/");

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-ink">AI要因分析レポート</h1>
        <p className="mt-1 text-sm text-ink-muted">損益変動の要因をAIが要約します。</p>
      </header>
      <ReportGenerator />
    </main>
  );
}
