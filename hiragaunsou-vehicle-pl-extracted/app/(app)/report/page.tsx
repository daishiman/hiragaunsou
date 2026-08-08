import { redirect } from "next/navigation";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { PageHead } from "../../_components/PageHead";
import { ReportGenerator } from "./ReportGenerator";

/** F12 AI要因分析レポート (S10画面)。生成はadmin/executiveのみ(要件定義4章「レポート配信設定」相当)。 */
export default async function ReportPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "report_settings")) {
    return <AccessDenied screenName="AI要因分析" permission="report_settings" />;
  }

  return (
    <div className="max-w-3xl">
      <PageHead
        kind="analysis"
        title="AI要因分析レポート"
        lead="損益変動の要因をAIが要約します(生成ごとに費用が発生)"
      />
      <ReportGenerator />
    </div>
  );
}
