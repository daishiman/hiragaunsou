import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1AnnualReferenceRepository } from "../../../src/infrastructure/db/D1AnnualReferenceRepository";
import {
  GetAnnualSummaryUseCase,
  RECONCILIATION_TOLERANCE,
} from "../../../src/usecase/steps/getAnnualSummary";
import type { MonthTotals } from "../../../src/domain/rules/monthlyAggregation";
import { costBreakdown, diffRatio } from "../../../src/domain/rules/periodAggregation";
import { selectableYearMonths } from "../../_lib/yearMonth";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { kmPriceLabel, man, num, pct, yen } from "../../_lib/format";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { PageHead } from "../../_components/PageHead";
import { EmptyState } from "../../_components/EmptyState";
import { StatTile } from "../../_components/StatTile";
import { TrendBars } from "../../_components/charts/TrendBars";
import { ShareBars } from "../../_components/charts/ShareBars";

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
 * S8 年間集計・対前年。
 *
 * この画面の目的は1つ:「この1期、去年と比べてどうだったか」。
 * 主役は年間損益の1数字で、推移はグラフが答える。
 * 月別の明細表 (12列×8行) は読み物なので既定で畳み、開く前に中身が分かるラベルを付ける。
 */
export default async function AnnualPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "view")) {
    return <AccessDenied screenName="年間集計・対前年" permission="view" />;
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
  const useCase = new GetAnnualSummaryUseCase(
    new D1VehiclePlRepository(db),
    new D1AnnualReferenceRepository(db),
  );
  const data = await useCase.execute(yearMonth);

  /*
    この会社の期は6月始まりなので、7月に2026年5月分を見ようとすると「今期」には入っていない。
    5月の実績はきちんと残っているのに画面が空になり、消えたように見えるのはこのため。
    期を1つずつ前後に動かせる導線を常に出し、今期が空のときは前の期に実績があるかまで見て名指しする。
  */
  const prevFiscalAnchor = `${data.fiscalYear - 1}-06`;
  const nextFiscalAnchor = `${data.fiscalYear + 1}-06`;
  const prevFiscalData = data.isEmpty ? await useCase.execute(prevFiscalAnchor) : null;
  const prevFiscalHasData = prevFiscalData !== null && !prevFiscalData.isEmpty;

  const prev = data.comparisonPrevTotal;
  const hasPrevYear = prev !== null;
  const hasSheet = data.reconciliation.some((r) => r.sheetSales !== null);
  const importedCount = data.months.filter((m) => !m.isEmpty).length;
  const costSlices = costBreakdown(data.total);

  return (
    <>
      <PageHead
        kind="data"
        title="年間集計・対前年"
        action={
          <YearMonthSelect basePath="/annual" value={yearMonth} options={selectableYearMonths(25)} />
        }
      />

      <div className="-mt-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-ink-muted">
        <Link href={`/annual?ym=${prevFiscalAnchor}`} className="text-brand-deep hover:underline">
          ← 前の期
        </Link>
        <span>
          <span className="num">{data.fiscalYear}</span>年6月〜
          <span className="num">{data.fiscalYear + 1}</span>年5月 (1期) ・ 取込済{" "}
          <span className="num">
            {importedCount}/{data.months.length}
          </span>
          ヶ月
        </span>
        <Link href={`/annual?ym=${nextFiscalAnchor}`} className="text-brand-deep hover:underline">
          次の期 →
        </Link>
      </div>

      {data.isEmpty ? (
        prevFiscalHasData ? (
          <EmptyState
            title="この期のデータはまだありません"
            description={`${data.fiscalYear}年6月からの実績はまだありません。${data.fiscalYear - 1}年6月〜${data.fiscalYear}年5月の実績は、1つ前の期にまとまっています。`}
            actionHref={`/annual?ym=${prevFiscalAnchor}`}
            actionLabel="前の期の集計を見る"
          />
        ) : (
          <EmptyState
            title="この期のデータはまだありません"
            description="月次データを取り込むと、13ヶ月の推移と対前年比較が表示されます。"
          />
        )
      ) : (
        <>
          {/* 主役 = 年間損益。残りは同格に揃えて静かに置く */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              hero
              label="年間損益"
              value={man(data.total.profit)}
              negative={data.total.profit < 0}
              diff={hasPrevYear ? diffRatio(data.total.profit, prev.profit) : null}
              diffLabel="前期比"
              sub={`利益率 ${pct(data.totalMargin)}`}
            />
            <StatTile
              label="年間売上"
              value={man(data.total.sales)}
              diff={hasPrevYear ? diffRatio(data.total.sales, prev.sales) : null}
              diffLabel="前期比"
            />
            <StatTile
              label="年間経費"
              value={man(data.total.expense)}
              diff={hasPrevYear ? diffRatio(data.total.expense, prev.expense) : null}
              diffLabel="前期比"
            />
            <StatTile
              label="1kmあたり原価"
              value={kmPriceLabel(data.totalCostPerKm)}
              sub={`売上 ${kmPriceLabel(data.totalSalesPerKm)}`}
            />
          </div>

          {/* Excel突合は「件数」ではなく状態が主。色だけで伝えず文字ラベルを付ける */}
          <div
            className={[
              "mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm",
              !hasSheet
                ? "border-line bg-white text-ink-muted"
                : data.reconciliationGapCount > 0
                  ? "border-caution-border bg-caution-soft text-ink"
                  : "border-line bg-white text-ink",
            ].join(" ")}
          >
            <span className="text-xs font-semibold text-ink-muted">Excel年間集計シートとの突合</span>
            {!hasSheet ? (
              <span className="text-xs">未登録</span>
            ) : data.reconciliationGapCount > 0 ? (
              <span className="font-bold text-danger">
                要確認 <span className="num">{data.reconciliationGapCount}</span>ヶ月
              </span>
            ) : (
              <span className="font-bold">全月一致</span>
            )}
            {/* 月合計の差の内訳は車番別でしか読めない。同じ月の月次収支表へ渡す。 */}
            <Link
              href={`/grid?ym=${encodeURIComponent(yearMonth)}`}
              className="ml-auto text-xs font-semibold text-brand-deep hover:underline"
            >
              車番別の差異を見る →
            </Link>
          </div>

          <section className="mt-4 rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-bold text-ink">損益の13ヶ月推移</h2>
            <div className="mt-3">
              <TrendBars
                title="損益"
                points={data.trend.map((m) => ({
                  label: m.label,
                  value: m.profit,
                  reference: m.prevProfit,
                  isEmpty: m.isEmpty,
                }))}
                referenceLabel="前年同月"
                signed
              />
            </div>
          </section>

          <section className="mt-4 rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-bold text-ink">売上の13ヶ月推移</h2>
            <div className="mt-3">
              <TrendBars
                title="売上"
                points={data.trend.map((m) => ({
                  label: m.label,
                  value: m.sales,
                  reference: m.prevSales,
                  isEmpty: m.isEmpty,
                }))}
                referenceLabel="前年同月"
              />
            </div>
          </section>

          <section className="mt-4 rounded-xl border border-line bg-white p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">年間の経費内訳</h2>
              <p className="num text-xs text-ink-muted">計 {man(data.total.expense)}</p>
            </div>
            <div className="mt-3">
              <ShareBars
                items={costSlices.map((s) => ({
                  label: s.label,
                  value: s.amount,
                  share: s.share,
                }))}
              />
            </div>
          </section>

          {/* ここから下は「読む表」。既定で畳み、開く前に中身と件数が分かるようにする */}
          <details className="group mt-4 rounded-xl border border-line bg-white">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-bold text-ink hover:bg-subtle">
              月別の明細を見る
              <span className="ml-2 text-xs font-normal text-ink-muted">
                経費8区分・売上・損益・走行距離・km単価を月ごとに
              </span>
            </summary>
            <div className="overflow-x-auto border-t border-line">
              <table className="data-table w-full min-w-max border-collapse text-xs">
                <caption className="sr-only">月別の経費内訳明細 (円)</caption>
                <thead>
                  <tr className="border-b border-line bg-subtle text-ink-muted">
                    <th className="sticky left-0 z-10 bg-subtle px-3 py-2 text-left font-medium">
                      項目(円)
                    </th>
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
            </div>
          </details>

          <details className="group mt-4 rounded-xl border border-line bg-white">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-bold text-ink hover:bg-subtle">
              前期との月別差額を見る
              <span className="ml-2 text-xs font-normal text-ink-muted">
                {hasPrevYear ? "売上差・損益差を月ごとに" : "前期実績が未登録"}
              </span>
            </summary>
            {!hasPrevYear ? (
              <p className="border-t border-line px-5 py-4 text-xs text-ink-muted">
                前期の売上・経費を登録すると、ここに月別の差額が出ます。
              </p>
            ) : (
              <div className="overflow-x-auto border-t border-line">
                <table className="data-table w-full min-w-max border-collapse text-xs">
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
          </details>

          {/* 差がある月は初手で開く。「一致」の表は開かない (読む価値が無い) */}
          <details
            open={data.reconciliationGapCount > 0}
            className="group mt-4 rounded-xl border border-line bg-white"
          >
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-bold text-ink hover:bg-subtle">
              Excelとの差額を見る
              <span className="ml-2 text-xs font-normal text-ink-muted">
                差が <span className="num">{num(RECONCILIATION_TOLERANCE)}</span> 円を超えた月だけ要確認
              </span>
            </summary>
            {!hasSheet ? (
              <p className="border-t border-line px-5 py-4 text-xs text-ink-muted">
                Excel年間集計シートの値を登録すると、月ごとに自動で照合します。
              </p>
            ) : (
              <div className="overflow-x-auto border-t border-line">
                <table className="data-table w-full min-w-max border-collapse text-xs">
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
                        <td className="px-3 py-2 font-medium">
                          <Link
                            href={`/grid?ym=${encodeURIComponent(r.yearMonth)}`}
                            className="text-brand-deep hover:underline"
                          >
                            {r.label}
                          </Link>
                        </td>
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
            )}
          </details>

          <p className="mt-4 text-center text-xs text-ink-muted">
            <Link href="/dashboard" className="font-semibold text-brand-deep hover:underline">
              期間を指定して見る (ダッシュボード) →
            </Link>
          </p>
        </>
      )}
    </>
  );
}
