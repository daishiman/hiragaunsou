import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";
import { D1CleansingDecisionRepository } from "../../../src/infrastructure/db/D1CleansingDecisionRepository";
import { GetCleansingQueueUseCase } from "../../../src/usecase/steps/getCleansingQueue";
import { selectableYearMonths } from "../../_lib/yearMonth";
import { findScreen } from "../../_lib/screens";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { CleansingQueue } from "./CleansingQueue";

/**
 * 業務フロー STEP2「データ整形(傭車・2重計上・諸口の処理)」。
 *
 * 判定に使う運転者名・荷主名などは売上モニタリスト(STEP2)にしか無いため、
 * STEP1(車両別運行実績表の取り込み)ではなくSTEP2の一部として位置づける。
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
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "view")) {
    // 画面の名前は screens.ts が唯一の出どころ。ここで別名を書くと横のメニューと食い違う
    return (
      <AccessDenied screenName={findScreen("/cleansing")?.label ?? "データ整形"} permission="view" />
    );
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
  const data = await new GetCleansingQueueUseCase(
    new D1ImportBatchRepository(db),
    new D1CleansingDecisionRepository(db),
  ).execute(yearMonth);

  return (
    <>
      <ScreenHeader
        screen="/cleansing"
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
