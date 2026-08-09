import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { GetAnomalyQueueUseCase } from "../../../src/usecase/steps/getAnomalyQueue";
import { selectableYearMonths } from "../../_lib/yearMonth";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { PageHead } from "../../_components/PageHead";
import { D1VehicleMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import { AnomalyQueue } from "./AnomalyQueue";
import { LeaseEditor } from "./LeaseEditor";

/**
 * S3 異常値チェック (モック view-anomaly.js に対応)。
 * 一覧ではなく1件ずつの判定キュー。取込直後に必ずここを通す想定。
 */
export default async function AnomalyPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "view")) {
    return <AccessDenied screenName="チェック" permission="view" />;
  }

  const { ym } = await searchParams;

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);

  /*
    対象月の既定は「まだ締めていない、取込のある最も新しい月」に揃える(app/_lib/workingYearMonth.ts)。
    以前は画面ごとに当月・前月とバラバラで、取込画面で5月分を取り込んでから移ると
    別の月の空っぽの画面が出て「取り込んだのに反映されていない」ように見えていた。
  */
  const yearMonth = ym || (await resolveWorkingYearMonth(db));
  const useCase = new GetAnomalyQueueUseCase(
    new D1ReviewFlagRepository(db),
    new D1VehiclePlRepository(db),
  );
  const [data, vehicles] = await Promise.all([
    useCase.execute(yearMonth),
    new D1VehicleMasterRepository(db).findAllActive(),
  ]);

  return (
    <>
      <PageHead
        kind="ops"
        title="収支表のチェック(業務フロー STEP7)"
        lead="いつもと違う値を1件ずつ「入力ミス」か「実績」か判定します"
        showHomeLink
        action={
          <YearMonthSelect basePath="/anomaly" value={yearMonth} options={selectableYearMonths(13)} />
        }
      />

      <AnomalyQueue
        items={data.items}
        yearMonth={yearMonth}
        canApprove={checkAccess(session, "approve_anomaly")}
      />

      <LeaseEditor
        yearMonth={yearMonth}
        canEdit={checkAccess(session, "input")}
        rows={vehicles.map((v) => ({
          vehicleNo: v.vehicleNo,
          vehicleType: v.vehicleType,
          lease: v.lease,
          installment: v.installment,
        }))}
      />
    </>
  );
}
