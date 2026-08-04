import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1AnnualReferenceRepository } from "../../../src/infrastructure/db/D1AnnualReferenceRepository";
import {
  GetAnnualSummaryUseCase,
  RECONCILIATION_TOLERANCE,
} from "../../../src/usecase/steps/getAnnualSummary";
import type { MonthTotals } from "../../../src/domain/rules/monthlyAggregation";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";
import { kmPriceLabel, man, num, pct, yen } from "../../_lib/format";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { PageHead } from "../../_components/PageHead";
import { EmptyState } from "../../_components/EmptyState";
import { BarRow } from "../../_components/BarRow";

/** 経費明細の行構成 (モック view-annual.js の cols と同じ8区分) */
const COST_ROWS = [
  ["運行費", "tollNet"],
  ["燃料費", "fuelTotal"],
  ["修繕費", "repairTotal"],
  ["人件費", "laborTotal"],
  ["保険料", "insTotal"],
  ["賦課税", "taxTotal"],
  ["運送費", "transportTotal"],
  ["一般管理費", "adminTotal"],
] as const satisfies readonly (readonly [string, keyof MonthTotals])[];

/**
 * S8 年間集計・対前年 (モック view-annual.js に対応)。
 * 12ヶ月推移 → 経費明細 → 対前年 → 現行Excel年間集計シートとの突合 の順に並べる。
 */
export default async function AnnualPage({
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
  const useCase = new GetAnnualSummaryUseCase(
    new D1VehiclePlRepository(db),
    new D1AnnualReferenceRepository(db),
  );
  const data = await useCase.execute(yearMonth);

  const profitMax = Math.max(...data.months.map((m) => Math.abs(m.totals.profit)), 1);
  const hasPrevYear = data.comparisonPrevTotal !== null;
  const hasSheet = data.reconciliation.some((r) => r.sheetSales !== null);

  return (
    <>
      <PageHead
        kind="data"
        title="年間集計・対前年"
        lead={`${data.fiscalYear}年6月〜${data.fiscalYear + 1}年5月(1期)の推移です。月次収支表を積み上げた値で、Excelの年間集計シートとは自動で突合します。`}
        action={
          <YearMonthSelect basePath="/annual" value={yearMonth} options={selectableYearMonths(25)} />
        }
      />

      {data.isEmpty ? (
        <EmptyState
          title="この期のデータはまだありません"
          description="月次データを取り込むと、12ヶ月の推移と対前年比較が表示されます。"
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">年間売上</p>
              <p className="num mt-1 text-2xl font-bold text-ink">{man(data.total.sales)}</p>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">年間経費</p>
              <p className="num mt-1 text-2xl font-bold text-ink">{man(data.total.expense)}</p>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">年間損益</p>
              <p
                className={`num mt-1 text-2xl font-bold ${data.total.profit < 0 ? "text-danger" : "text-accent"}`}
              >
                {man(data.total.profit)}
              </p>
              <p className="mt-1 text-[11px] text-ink-muted">利益率 {pct(data.totalMargin)}</p>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">1kmあたり原価 / 売上</p>
              <p className="num mt-1 text-xl font-bold text-ink">
                {kmPriceLabel(data.totalCostPerKm)}
                <span className="ml-1 text-sm font-normal text-ink-muted">
                  / {kmPriceLabel(data.totalSalesPerKm)}
                </span>
              </p>
            </div>
          </div>

          <section className="mt-5 rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-bold text-ink">損益の12ヶ月推移</h2>
            <p className="mt-1 text-xs text-ink-muted">
              棒の長さは損益の絶対値(最大月を100%とした比較)。未取込の月は空欄です。
            </p>
            <div className="mt-3">
              {data.months.map((m) => (
                <BarRow
                  key={m.yearMonth}
                  label={m.label}
                  value={m.totals.profit}
                  max={profitMax}
                  display={m.isEmpty ? "未取込" : `${yen(m.totals.profit)}円`}
                  tone={m.isEmpty ? "quiet" : m.totals.profit < 0 ? "danger" : "brand"}
                  sub={m.isEmpty ? undefined : `売上 ${man(m.totals.sales)} / 赤字 ${num(m.totals.deficitCars)}台`}
                />
              ))}
            </div>
          </section>

          <section className="mt-5 overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-max border-collapse text-xs">
              <caption className="border-b border-line px-5 py-3 text-left text-sm font-bold text-ink">
                経費内訳の明細(円)
              </caption>
              <thead>
                <tr className="border-b border-line bg-subtle text-ink-muted">
                  <th className="sticky left-0 z-10 bg-subtle px-3 py-2 text-left font-medium">項目</th>
                  {data.months.map((m) => (
                    <th key={m.yearMonth} className="px-3 py-2 text-right font-medium">
                      {m.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">年間合計</th>
                </tr>
              </thead>
              <tbody>
                {COST_ROWS.map(([label, key]) => (
                  <tr key={key} className="border-b border-line">
                    <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-ink">
                      {label}
                    </th>
                    {data.months.map((m) => (
                      <td key={m.yearMonth} className="num px-3 py-2 text-right">
                        {m.isEmpty ? "—" : yen(m.totals[key])}
                      </td>
                    ))}
                    <td className="num px-3 py-2 text-right font-bold">{yen(data.total[key])}</td>
                  </tr>
                ))}
                <tr className="border-b border-line bg-subtle">
                  <th className="sticky left-0 z-10 bg-subtle px-3 py-2 text-left font-medium text-ink">
                    経費計
                  </th>
                  {data.months.map((m) => (
                    <td key={m.yearMonth} className="num px-3 py-2 text-right font-bold">
                      {m.isEmpty ? "—" : yen(m.totals.expense)}
                    </td>
                  ))}
                  <td className="num px-3 py-2 text-right font-bold">{yen(data.total.expense)}</td>
                </tr>
                <tr className="border-b border-line">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-ink">
                    売上
                  </th>
                  {data.months.map((m) => (
                    <td key={m.yearMonth} className="num px-3 py-2 text-right">
                      {m.isEmpty ? "—" : yen(m.totals.sales)}
                    </td>
                  ))}
                  <td className="num px-3 py-2 text-right font-bold">{yen(data.total.sales)}</td>
                </tr>
                <tr className="border-b border-line bg-subtle">
                  <th className="sticky left-0 z-10 bg-subtle px-3 py-2 text-left font-medium text-ink">
                    損益
                  </th>
                  {data.months.map((m) => (
                    <td
                      key={m.yearMonth}
                      className={`num px-3 py-2 text-right font-bold ${m.totals.profit < 0 ? "text-danger" : ""}`}
                    >
                      {m.isEmpty ? "—" : yen(m.totals.profit)}
                    </td>
                  ))}
                  <td
                    className={`num px-3 py-2 text-right font-bold ${data.total.profit < 0 ? "text-danger" : ""}`}
                  >
                    {yen(data.total.profit)}
                  </td>
                </tr>
                <tr className="border-b border-line">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-ink">
                    走行距離(km)
                  </th>
                  {data.months.map((m) => (
                    <td key={m.yearMonth} className="num px-3 py-2 text-right">
                      {m.isEmpty ? "—" : num(m.totals.km, 1)}
                    </td>
                  ))}
                  <td className="num px-3 py-2 text-right font-bold">{num(data.total.km, 1)}</td>
                </tr>
                <tr className="border-b border-line">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-ink">
                    1km原価
                  </th>
                  {data.months.map((m) => (
                    <td key={m.yearMonth} className="num px-3 py-2 text-right">
                      {kmPriceLabel(m.costPerKm)}
                    </td>
                  ))}
                  <td className="num px-3 py-2 text-right font-bold">
                    {kmPriceLabel(data.totalCostPerKm)}
                  </td>
                </tr>
                <tr>
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-ink">
                    1km売上
                  </th>
                  {data.months.map((m) => (
                    <td key={m.yearMonth} className="num px-3 py-2 text-right">
                      {kmPriceLabel(m.salesPerKm)}
                    </td>
                  ))}
                  <td className="num px-3 py-2 text-right font-bold">
                    {kmPriceLabel(data.totalSalesPerKm)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="mt-5 rounded-xl border border-line bg-white">
            <div className="border-b border-line px-5 py-3">
              <h2 className="text-sm font-bold text-ink">対前年(前期実績との比較)</h2>
              <p className="mt-1 text-xs text-ink-muted">
                前期実績は annual_reference(kind=prev_year_actual)に登録された値を使います。
              </p>
            </div>
            {!hasPrevYear ? (
              <p className="px-5 py-6 text-xs text-ink-muted">
                前期実績が未登録のため比較できません。前期の売上・経費を登録すると自動で比較されます。
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-line bg-subtle text-ink-muted">
                      <th className="px-3 py-2 text-left font-medium">月</th>
                      <th className="px-3 py-2 text-right font-medium">今期売上(円)</th>
                      <th className="px-3 py-2 text-right font-medium">前期売上(円)</th>
                      <th className="px-3 py-2 text-right font-medium">売上差(円)</th>
                      <th className="px-3 py-2 text-right font-medium">今期損益(円)</th>
                      <th className="px-3 py-2 text-right font-medium">前期損益(円)</th>
                      <th className="px-3 py-2 text-right font-medium">損益差(円)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.comparison.map((c) => (
                      <tr key={c.yearMonth} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2 font-medium">{c.label}</td>
                        <td className="num px-3 py-2 text-right">{yen(c.sales)}</td>
                        <td className="num px-3 py-2 text-right">{yen(c.prevSales)}</td>
                        <td
                          className={`num px-3 py-2 text-right font-bold ${(c.salesDiff ?? 0) < 0 ? "text-danger" : ""}`}
                        >
                          {yen(c.salesDiff)}
                        </td>
                        <td className={`num px-3 py-2 text-right ${c.profit < 0 ? "text-danger" : ""}`}>
                          {yen(c.profit)}
                        </td>
                        <td className="num px-3 py-2 text-right">{yen(c.prevProfit)}</td>
                        <td
                          className={`num px-3 py-2 text-right font-bold ${(c.profitDiff ?? 0) < 0 ? "text-danger" : ""}`}
                        >
                          {yen(c.profitDiff)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-5 rounded-xl border border-line bg-white">
            <div className="border-b border-line px-5 py-3">
              <h2 className="text-sm font-bold text-ink">現行Excel年間集計シートとの突合</h2>
              <p className="mt-1 text-xs text-ink-muted">
                差が {num(RECONCILIATION_TOLERANCE)} 円を超えた月だけ「要確認」として出します。
              </p>
            </div>
            {!hasSheet ? (
              <p className="px-5 py-6 text-xs text-ink-muted">
                Excel年間集計シートの値が未登録のため突合できません。
                annual_reference(kind=excel_annual_sheet)に登録すると自動で照合します。
              </p>
            ) : (
              <>
                {data.reconciliationGapCount > 0 && (
                  <p className="mx-5 mt-4 rounded-md border border-caution-border bg-caution-soft px-3 py-2 text-xs leading-relaxed text-ink">
                    {data.reconciliationGapCount}ヶ月でExcelとの差が見つかりました。どちらが正しいかを確認してください。
                  </p>
                )}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-max border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-line bg-subtle text-ink-muted">
                        <th className="px-3 py-2 text-left font-medium">月</th>
                        <th className="px-3 py-2 text-right font-medium">本システム売上(円)</th>
                        <th className="px-3 py-2 text-right font-medium">Excel売上(円)</th>
                        <th className="px-3 py-2 text-right font-medium">差(円)</th>
                        <th className="px-3 py-2 text-right font-medium">本システム経費(円)</th>
                        <th className="px-3 py-2 text-right font-medium">Excel経費(円)</th>
                        <th className="px-3 py-2 text-right font-medium">差(円)</th>
                        <th className="px-3 py-2 text-left font-medium">判定</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.reconciliation.map((r) => (
                        <tr
                          key={r.yearMonth}
                          className={`border-b border-line last:border-b-0 ${r.hasGap ? "bg-caution-soft" : ""}`}
                        >
                          <td className="px-3 py-2 font-medium">{r.label}</td>
                          <td className="num px-3 py-2 text-right">{yen(r.systemSales)}</td>
                          <td className="num px-3 py-2 text-right">{yen(r.sheetSales)}</td>
                          <td className="num px-3 py-2 text-right font-bold">{yen(r.salesGap)}</td>
                          <td className="num px-3 py-2 text-right">{yen(r.systemExpense)}</td>
                          <td className="num px-3 py-2 text-right">{yen(r.sheetExpense)}</td>
                          <td className="num px-3 py-2 text-right font-bold">{yen(r.expenseGap)}</td>
                          <td className="px-3 py-2">
                            {r.sheetSales === null ? (
                              <span className="text-ink-muted">Excel未登録</span>
                            ) : r.hasGap ? (
                              <span className="font-semibold text-danger">要確認</span>
                            ) : (
                              <span className="text-ink-muted">一致</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
