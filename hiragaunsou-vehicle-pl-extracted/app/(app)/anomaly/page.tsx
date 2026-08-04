import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { GetAnomalyQueueUseCase } from "../../../src/usecase/steps/getAnomalyQueue";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";
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
  if (!checkAccess(session, "view")) redirect("/");

  const { ym } = await searchParams;
  const yearMonth = ym || currentYearMonth();

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
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
