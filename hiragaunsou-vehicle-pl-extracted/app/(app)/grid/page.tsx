import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";
import { GetMonthlyGridUseCase } from "../../../src/usecase/steps/getMonthlyGrid";
import { GetExcelReconciliationUseCase } from "../../../src/usecase/steps/getExcelReconciliation";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";
import { yearMonthLabel } from "../../_lib/format";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { PageHead } from "../../_components/PageHead";
import { EmptyState } from "../../_components/EmptyState";
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
  if (!checkAccess(session, "view")) redirect("/");

  const { ym } = await searchParams;
  const yearMonth = ym || currentYearMonth();

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const plRepo = new D1VehiclePlRepository(db);
  const flagRepo = new D1ReviewFlagRepository(db);
  // Excelとの差もセルの所見として表に出すため、突合を先に済ませてからグリッドを組む。
  const [confirmation, reconciliation] = await Promise.all([
    new ConfirmMonthlyPlUseCase(plRepo, flagRepo).status(yearMonth),
    new GetExcelReconciliationUseCase(plRepo, new D1ImportBatchRepository(db)).execute(yearMonth),
  ]);
  const grid = await new GetMonthlyGridUseCase(
    plRepo,
    flagRepo,
    new D1VehiclePlOverrideRepository(db),
    new D1PlIssueAckRepository(db),
  ).execute(yearMonth, reconciliation);

  return (
    <>
      <PageHead
        kind="data"
        title="月次収支表(業務フロー STEP8)"
        lead="車両別の収支。転記は不要で、CSVで書き出せます"
        showHomeLink
        action={<YearMonthSelect basePath="/grid" value={yearMonth} options={selectableYearMonths(13)} />}
      />

      {grid.isEmpty ? (
        <EmptyState
          title={`${yearMonthLabel(yearMonth)}のデータはまだありません`}
          description="月次データ取込でExcel/CSVを取り込むと、ここに車両別の収支が表示されます。"
          actionLabel="月次データ取込へ"
          actionHref="/import"
        />
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
          header={
            <>
              <ConfirmBar
                status={confirmation}
                yearMonth={yearMonth}
                canConfirm={checkAccess(session, "input")}
                postponedCount={grid.review.postponed}
              />
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-4 py-3">
                <p className="text-sm text-ink-muted">
                  収支表51列をそのままの並びで書き出します。Excelにそのまま貼り付けられます。
                </p>
                <a
                  href={`/api/export?yearMonth=${encodeURIComponent(yearMonth)}`}
                  className="pressable ml-auto rounded border border-brand px-3 py-1.5 text-sm font-semibold text-brand-deep"
                >
                  CSVで書き出す
                </a>
                {/* 数字そのものではなく「確認の記録」を渡したい場面 (上長・経理への報告) の入口。
                    CSVと並べて置く。どちらも「表を見終わったあとの出口」だから。 */}
                <Link
                  href={`/grid/report?ym=${encodeURIComponent(yearMonth)}`}
                  className="pressable rounded border border-line px-3 py-1.5 text-sm text-ink hover:bg-subtle"
                >
                  確認の記録を印刷・共有
                </Link>
              </div>
            </>
          }
          footer={<ExcelReconcileList result={reconciliation} />}
        />
      )}
    </>
  );
}
