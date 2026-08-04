import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { GetMonthlyGridUseCase } from "../../../src/usecase/steps/getMonthlyGrid";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";
import { yearMonthLabel } from "../../_lib/format";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { PageHead } from "../../_components/PageHead";
import { EmptyState } from "../../_components/EmptyState";
import { ConfirmMonthlyPlUseCase } from "../../../src/usecase/steps/confirmMonthlyPl";
import { GridTable } from "./GridTable";
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
  const [grid, confirmation] = await Promise.all([
    new GetMonthlyGridUseCase(plRepo, flagRepo).execute(yearMonth),
    new ConfirmMonthlyPlUseCase(plRepo, flagRepo).status(yearMonth),
  ]);

  return (
    <>
      <PageHead
        kind="data"
        title="月次収支表(業務フロー STEP8)"
        lead="車両別の収支。転記は不要で、CSVで書き出せます"
        action={<YearMonthSelect basePath="/grid" value={yearMonth} options={selectableYearMonths(13)} />}
      />

      {!grid.isEmpty && (
        <ConfirmBar
          status={confirmation}
          yearMonth={yearMonth}
          canConfirm={checkAccess(session, "input")}
        />
      )}

      {!grid.isEmpty && (
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
        </div>
      )}

      {grid.isEmpty ? (
        <EmptyState
          title={`${yearMonthLabel(yearMonth)}のデータはまだありません`}
          description="月次データ取込でExcel/CSVを取り込むと、ここに車両別の収支が表示されます。"
          actionLabel="月次データ取込へ"
          actionHref="/import"
        />
      ) : (
        <GridTable rows={grid.rows} yearMonth={yearMonth} />
      )}
    </>
  );
}
