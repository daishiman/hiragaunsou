import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";
import { D1CleansingDecisionRepository } from "../../../src/infrastructure/db/D1CleansingDecisionRepository";
import { GetCleansingQueueUseCase } from "../../../src/usecase/steps/getCleansingQueue";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";
import { yearMonthLabel } from "../../_lib/format";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { PageHead } from "../../_components/PageHead";
import { CleansingQueue } from "./CleansingQueue";

/**
 * 業務フロー STEP1「データ整形(傭車・2重計上・諸口の処理)」。
 *
 * docx で唯一「属人化工程」と名指しされている手順。判定ルール(88888=傭車 /
 * 888・10・5000番=2重計上の実績あり / 運転者「諸口」)はシステムが持ち、
 * 最終判断だけを人が1クリックで下す形にする。
 */
export default async function CleansingPage({
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
  const data = await new GetCleansingQueueUseCase(
    new D1ImportBatchRepository(db),
    new D1CleansingDecisionRepository(db),
  ).execute(yearMonth);

  return (
    <>
      <PageHead
        kind="ops"
        title="データ整形(業務フロー STEP1)"
        lead={`${yearMonthLabel(yearMonth)}の取込データのうち、傭車・2重計上の疑い・諸口にあたる伝票だけを出します。1件ずつ「除外する / 修正して残す / そのまま残す」を選ぶと、収支表に反映されます。`}
        action={
          <YearMonthSelect basePath="/cleansing" value={yearMonth} options={selectableYearMonths(13)} />
        }
      />

      <CleansingQueue
        yearMonth={yearMonth}
        initialItems={data.items}
        charteredExcluded={data.charteredExcluded}
        totalRows={data.totalRows}
        notImported={data.notImported}
        canDecide={checkAccess(session, "input")}
      />
    </>
  );
}
