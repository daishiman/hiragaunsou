import { redirect } from "next/navigation";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { PageHead } from "../../_components/PageHead";
import { ReportGenerator } from "./ReportGenerator";

/** F12 AI要因分析レポート (S10画面)。生成はadmin/executiveのみ(要件定義4章「レポート配信設定」相当)。 */
export default async function ReportPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "report_settings")) redirect("/");

  return (
    <div className="max-w-3xl">
      <PageHead
        kind="tool"
        title="AI要因分析レポート"
        lead="損益変動の要因をAIが要約します。生成のたびにトークン費用が発生します(利用状況で確認できます)。"
      />
      <ReportGenerator />
    </div>
  );
}
