import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1RateMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import { D1AnnualReferenceRepository } from "../../../src/infrastructure/db/D1AnnualReferenceRepository";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { GetPeriodOverviewUseCase } from "../../../src/usecase/steps/getPeriodOverview";
import { isYearMonth, periodPresets, selectableYearMonths } from "../../_lib/yearMonth";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { chartMonthLabel, kmPriceLabel, man, num, pct, yen } from "../../_lib/format";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { EmptyState } from "../../_components/EmptyState";
import { PeriodSelect } from "../../_components/PeriodSelect";
import { StatTile } from "../../_components/StatTile";
import { TrendBars } from "../../_components/charts/TrendBars";
import { ShareBars } from "../../_components/charts/ShareBars";

/**
 * 経営ダッシュボード。
 *
 * この画面の目的は1つ:「この期間、儲かっているか。どこが食っているか」。
 * 主役は期間損益の1数字で、それ以外はすべて脇役として静かに置く。
 * 説明文は書かず、推移・構成比・ランキングの図が直接答える形にしている。
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "view")) {
    return <AccessDenied screenName="ダッシュボード" permission="view" />;
  }

  const presets = periodPresets();
  const fallback = presets[1] ?? presets[0];
  const params = await searchParams;
  const from = isYearMonth(params.from) ? params.from : (fallback?.from ?? "");
  const to = isYearMonth(params.to) ? params.to : (fallback?.to ?? "");

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  // 未判定件数も他画面と同じ作業対象月で数える。当月で数えると、5月分の判定が残っていても0件に見える。
  const anomalyYearMonth = await resolveWorkingYearMonth(db);
  const [data, openAnomalyFlags] = await Promise.all([
    new GetPeriodOverviewUseCase(
      new D1VehiclePlRepository(db),
      new D1RateMasterRepository(db),
      new D1AnnualReferenceRepository(db),
    ).execute(from, to),
    new D1ReviewFlagRepository(db).findOpenByYearMonth(anomalyYearMonth),
  ]);
  const anomalyCount = openAnomalyFlags.filter((f) => f.status === "open").length;

  const t = data.totals;

  return (
    <>
      <ScreenHeader
        screen="/dashboard"
        action={
          <PeriodSelect
            basePath="/dashboard"
            from={from}
            to={to}
            presets={presets}
            options={selectableYearMonths(25)}
          />
        }
      />

      <p className="-mt-3 mb-4 text-xs font-semibold text-ink-muted">{data.label}</p>

      {/*
        異常の早期発見: 分析画面から作業画面(チェック)へ気づいた瞬間に橋渡しする。
        0件のときは静かに消え、認知負荷を増やさない。
      */}
      {anomalyCount > 0 && (
        <Link
          href="/anomaly"
          className="pressable mb-4 flex items-center justify-between gap-2 rounded-lg border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm hover:bg-danger/10"
        >
          <span className="font-semibold text-danger">
            未処理の異常が <span className="num">{anomalyCount}</span> 件あります
          </span>
          <span className="text-xs font-semibold text-danger">チェックへ →</span>
        </Link>
      )}

      {data.isEmpty ? (
        <EmptyState
          title="この期間のデータはまだありません"
          description="月次データを取り込むと、損益の推移と内訳が表示されます。"
        />
      ) : (
        <>
          {/* 主役 = 期間損益。他のタイルは同格に揃えて静かに置く */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              hero
              label="期間損益"
              value={man(t.profit)}
              negative={t.profit < 0}
              diff={data.salesDiffRatio === null ? null : data.profitDiffRatio}
              diff2={data.profitMomDiffRatio}
              sub={`利益率 ${pct(data.margin)}`}
            />
            <StatTile
              label="売上"
              value={man(t.sales)}
              diff={data.salesDiffRatio}
              diff2={data.salesMomDiffRatio}
            />
            <StatTile
              label="赤字車両"
              value={num(data.deficitCount)}
              unit={`/ ${num(data.vehicleCount)}台`}
              negative={data.deficitCount > 0}
              href={`/deficit?ym=${to}`}
              linkLabel="赤字の理由"
            />
            <StatTile
              label="1kmあたり原価"
              value={kmPriceLabel(data.costPerKm)}
              sub={`売上 ${kmPriceLabel(data.salesPerKm)} / 分岐 ${num(
                data.thresholds.breakEvenKmPrice,
              )}円`}
            />
          </div>

          <section className="mt-4 card p-5">
            <h2 className="text-sm font-bold text-ink">損益の推移</h2>
            <div className="mt-3">
              <TrendBars
                title="損益"
                points={data.months.map((m, i) => ({
                  label: chartMonthLabel(m.yearMonth, i),
                  value: m.totals.profit,
                  reference: m.prevProfit,
                  isEmpty: m.isEmpty,
                }))}
                referenceLabel="前年同月"
                signed
              />
            </div>
          </section>

          <section className="mt-4 card p-5">
            <h2 className="text-sm font-bold text-ink">売上の推移</h2>
            <div className="mt-3">
              <TrendBars
                title="売上"
                points={data.months.map((m, i) => ({
                  label: chartMonthLabel(m.yearMonth, i),
                  value: m.totals.sales,
                  reference: m.prevSales,
                  isEmpty: m.isEmpty,
                }))}
                referenceLabel="前年同月"
              />
            </div>
          </section>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="card p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-bold text-ink">経費の内訳</h2>
                <p className="num text-xs text-ink-muted">計 {man(t.expense)}</p>
              </div>
              <div className="mt-3">
                <ShareBars
                  items={data.costSlices.map((s) => ({
                    label: s.label,
                    value: s.amount,
                    share: s.share,
                  }))}
                />
              </div>
            </section>

            <section className="card p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-bold text-ink">赤字が大きい車両</h2>
                <p className="num text-xs text-ink-muted">{num(data.deficitCount)}台</p>
              </div>
              {data.deficitRanking.length === 0 ? (
                <p className="mt-6 text-center text-sm text-ink-muted">赤字の車両はありません</p>
              ) : (
                <div className="mt-3">
                  <ShareBars
                    tone="danger"
                    items={data.deficitRanking.map((v) => ({
                      label: `${v.vehicleNo}`,
                      sub: [v.depot, v.driver].filter(Boolean).join(" / "),
                      value: v.profit,
                      href: `/vehicle/${encodeURIComponent(v.vehicleNo)}`,
                    }))}
                  />
                </div>
              )}
            </section>
          </div>

          {data.depots.length > 1 && (
            <section className="mt-4 card p-5">
              <h2 className="text-sm font-bold text-ink">営業所別</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="data-table w-full min-w-[30rem] text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs font-medium text-ink-muted">
                      <th className="py-2 text-left">所属</th>
                      <th className="py-2 text-right">台数</th>
                      <th className="py-2 text-right">赤字</th>
                      <th className="py-2 text-right">売上(円)</th>
                      <th className="py-2 text-right">損益(円)</th>
                      <th className="py-2 text-right">利益率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.depots.map((d) => (
                      <tr key={d.depot} className="border-b border-line last:border-b-0">
                        <td className="py-2 text-ink">{d.depot}</td>
                        <td className="num py-2 text-right">{num(d.cars)}</td>
                        <td
                          className={`num py-2 text-right ${
                            d.deficitCars > 0 ? "font-bold text-danger" : "text-ink-muted"
                          }`}
                        >
                          {num(d.deficitCars)}
                        </td>
                        <td className="num py-2 text-right">{yen(d.sales)}</td>
                        <td
                          className={`num py-2 text-right font-bold ${
                            d.profit < 0 ? "text-danger" : "text-ink"
                          }`}
                        >
                          {yen(d.profit)}
                        </td>
                        <td className="num py-2 text-right text-ink-muted">{pct(d.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 一段深い分析は既定で畳む。開く前から中身が分かるラベルにする */}
          <details className="group mt-4 card">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-bold text-ink hover:bg-subtle">
              km単価の分布を見る
              <span className="ml-2 text-xs font-normal text-ink-muted">
                {num(data.thresholds.breakEvenKmPrice)}円/km を下回る帯が赤字の主戦場
              </span>
            </summary>
            <div className="border-t border-line px-5 py-4">
              <ShareBars
                items={data.kmPriceBuckets.map((b) => ({
                  label: b.label,
                  sub: b.deficit > 0 ? `うち赤字 ${num(b.deficit)}台` : undefined,
                  value: b.count,
                }))}
                formatValue={(v) => `${num(v)}台`}
              />
            </div>
          </details>

          <p className="mt-4 text-center text-xs text-ink-muted">
            <Link href={`/annual?ym=${to}`} className="font-semibold text-brand-deep hover:underline">
              年間集計・対前年を見る →
            </Link>
          </p>
        </>
      )}
    </>
  );
}
