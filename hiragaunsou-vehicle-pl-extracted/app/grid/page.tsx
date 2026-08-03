import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../src/infrastructure/auth/session";
import { checkAccess } from "../../src/infrastructure/auth/accessControl";
import { createDb } from "../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ReviewFlagRepository } from "../../src/infrastructure/db/D1ReviewFlagRepository";
import { GetMonthlyGridUseCase } from "../../src/usecase/steps/getMonthlyGrid";
import { currentYearMonth, selectableYearMonths } from "../_lib/yearMonth";
import { FIELD_LABELS, formatCellValue, isNumericField } from "../_lib/fieldLabels";
import { YearMonthSelect } from "../_components/YearMonthSelect";

/** F1 月次収支グリッド (S2画面)。Presentation層はUseCase呼び出しのみ。 */
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
  const useCase = new GetMonthlyGridUseCase(new D1VehiclePlRepository(db), new D1ReviewFlagRepository(db));
  const grid = await useCase.execute(yearMonth);

  return (
    <main className="mx-auto max-w-[1600px] px-5 py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">月次収支グリッド</h1>
          <p className="mt-1 text-sm text-ink-muted">車両×科目の収支表(異常セルはハイライト)</p>
        </div>
        <YearMonthSelect basePath="/grid" value={yearMonth} options={selectableYearMonths(13)} />
      </header>

      {grid.isEmpty ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink">{yearMonth}のデータはまだありません</p>
          <p className="mt-1 text-sm text-ink-muted">データ取込を開始してください。</p>
          <div className="mt-4">
            <Link
              href="/import"
              className="pressable inline-block rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
            >
              データ取込へ
            </Link>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="min-w-max border-collapse text-xs">
            <thead>
              <tr className="border-b border-line bg-subtle">
                {grid.fields.map((field) => (
                  <th
                    key={field}
                    className="whitespace-nowrap px-3 py-2 text-left font-bold text-ink-muted"
                  >
                    {FIELD_LABELS[field]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.vehicleNo} className="border-b border-line last:border-b-0 hover:bg-subtle">
                  {grid.fields.map((field) => {
                    const highlighted = row.highlightedFields.includes(field);
                    return (
                      <td
                        key={field}
                        className={[
                          "whitespace-nowrap px-3 py-2",
                          isNumericField(field) ? "num text-right" : "text-left",
                          highlighted ? "border border-caution-border bg-caution-soft" : "",
                        ].join(" ")}
                        title={highlighted ? "例月と比較して異常の疑いがあります" : undefined}
                      >
                        {formatCellValue(field, row.values[field])}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
