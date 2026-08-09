import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { StickyActionBar } from "../../_components/StickyActionBar";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";
import { GetMonthlyGridUseCase } from "../../../src/usecase/steps/getMonthlyGrid";
import { GetExcelReconciliationUseCase } from "../../../src/usecase/steps/getExcelReconciliation";
import { selectableYearMonths } from "../../_lib/yearMonth";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { yearMonthLabel } from "../../_lib/format";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { EmptyState } from "../../_components/EmptyState";
import { RebuildPanel } from "./RebuildPanel";
import { ConfirmMonthlyPlUseCase } from "../../../src/usecase/steps/confirmMonthlyPl";
import { GridTable } from "./GridTable";
import { D1VehiclePlOverrideRepository } from "../../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import { D1PlIssueAckRepository } from "../../../src/infrastructure/db/D1PlIssueAckRepository";
import { ExcelReconcileList } from "./ExcelReconcileList";
import { ConfirmBar } from "./ConfirmBar";

/** F1 月次収支表 (S2画面)。Presentation層はUseCase呼び出しのみ。 */
export default async function GridPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "view")) {
    return <AccessDenied screenName="月次収支表" permission="view" />;
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
  const plRepo = new D1VehiclePlRepository(db);
  const flagRepo = new D1ReviewFlagRepository(db);
  // Excelとの差もセルの所見として表に出すため、突合を先に済ませてからグリッドを組む。
  const [confirmation, reconciliation] = await Promise.all([
    new ConfirmMonthlyPlUseCase(plRepo, flagRepo).status(yearMonth),
    new GetExcelReconciliationUseCase(plRepo, new D1ImportBatchRepository(db)).execute(yearMonth),
  ]);
  /*
    表が空のときに何を出すかは「取込がまだ」か「取込はあるのに収支表が無い」かで変わる。
    後者で「データ取込へ」だけを出すと、取り込んだ本人には同じファイルを入れ直す以外の
    道が見えない。判断材料はここで取っておく。
  */
  const importBatchRepo = new D1ImportBatchRepository(db);
  const [opBatch, salesBatch] = await Promise.all([
    importBatchRepo.findLatestBatch(yearMonth, "vehicle_operation"),
    importBatchRepo.findLatestBatch(yearMonth, "sales_monitor"),
  ]);
  const canRebuild = Boolean(opBatch && salesBatch);

  const grid = await new GetMonthlyGridUseCase(
    plRepo,
    flagRepo,
    new D1VehiclePlOverrideRepository(db),
    new D1PlIssueAckRepository(db),
  ).execute(yearMonth, reconciliation);

  return (
    <>
      <ScreenHeader
        screen="/grid"
        action={<YearMonthSelect basePath="/grid" value={yearMonth} options={selectableYearMonths(13)} />}
      />

      {grid.isEmpty ? (
        canRebuild && checkAccess(session, "input") ? (
          <RebuildPanel yearMonth={yearMonth} />
        ) : (
          <EmptyState
            title={`${yearMonthLabel(yearMonth)}のデータはまだありません`}
            description="月次データ取込でExcel/CSVを取り込むと、ここに車両別の収支が表示されます。"
            actionLabel="月次データ取込へ"
            actionHref={`/import?ym=${yearMonth}`}
          />
        )
      ) : (
        <GridTable
          rows={grid.rows}
          yearMonth={yearMonth}
          review={grid.review}
          // 確定済みの月を直せてしまうと、再計算で確定が自動的に外れる既存の仕組みと衝突し、
          // 確定したはずの月が黙って未確定に戻る。直すには先に確定を取り消してもらう。
          canEdit={checkAccess(session, "input") && !confirmation.isConfirmed}
          lockedReason={
            confirmation.isConfirmed
              ? "この月は確定済みです。数字を直すには、上の「確定を取り消す」を押してください。"
              : checkAccess(session, "input")
                ? null
                : "閲覧のみの権限のため、数字を直したり確認済みにしたりはできません。"
          }
          // 確定・書き出し・Excel突合は「表を見る」ときの操作。
          // 1件ずつ確認している最中には出さないよう、表と一緒に出し分けてもらう。
          footer={<ExcelReconcileList result={reconciliation} />}
          /*
            確定・書き出しは「表を見終わったあとの出口」。表は台数ぶん縦に伸びるので、
            他の画面の「ここまでを保存」と同じく画面の下端に貼り付け、いつでも押せるようにする。
          */
          actionBar={
            <StickyActionBar>
              <ConfirmBar
                status={confirmation}
                yearMonth={yearMonth}
                canConfirm={checkAccess(session, "input")}
                postponedCount={grid.review.postponed}
              />
              {/* 数字そのものではなく「確認の記録」を渡したい場面 (上長・経理への報告) の入口。
                  CSVと並べて置く。どちらも「表を見終わったあとの出口」だから。
                  他の画面と同じく、副次の操作を左、強い操作を右に置く。 */}
              <Link
                href={`/grid/report?ym=${encodeURIComponent(yearMonth)}`}
                className="btn btn-quiet pressable"
              >
                確認の記録を印刷・共有
              </Link>
              <a
                href={`/api/export?yearMonth=${encodeURIComponent(yearMonth)}`}
                className="btn btn-secondary pressable"
              >
                CSVで書き出す
              </a>
            </StickyActionBar>
          }
        />
      )}
    </>
  );
}
