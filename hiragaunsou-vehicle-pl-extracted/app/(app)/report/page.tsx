import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb } from "../../../src/infrastructure/db/client";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { ReportGenerator } from "./ReportGenerator";

/** F12 AI要因分析レポート (S10画面)。生成はadmin/executiveのみ(要件定義4章「レポート配信設定」相当)。 */
export default async function ReportPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "report_settings")) {
    return <AccessDenied screenName="AI要因分析" permission="report_settings" />;
  }

  // 生成の既定月も他画面と同じ「いま作業している月」。当月を既定にすると、
  // まだ収支表の無い月でレポートを作ろうとしてしまう。
  const { env } = await getCloudflareContext({ async: true });
  const defaultYearMonth = await resolveWorkingYearMonth(createDb(env.DB));

  return (
    <div>
      <ScreenHeader screen="/report" />
      <ReportGenerator defaultYearMonth={defaultYearMonth} />
    </div>
  );
}
