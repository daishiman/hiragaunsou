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
import { StickyFilterBar } from "../../_components/StickyFilterBar";
import { AlertPanel } from "../../_components/AlertPanel";
import { DataTable, type DataTableColumn } from "../../_components/DataTable";
import { TrendBars } from "../../_components/charts/TrendBars";
import { ShareBars } from "../../_components/charts/ShareBars";
import { findScreen } from "../../_lib/screens";
import type { DepotAggregate } from "../../../src/domain/rules/periodAggregation";

/**
 * 経営ダッシュボード。
 *
 * この画面の目的は1つ:「この期間、儲かっているか。どこが食っているか」。
 * 主役は期間損益の1数字で、それ以外はすべて脇役として静かに置く。
 * 説明文は書かず、推移・構成比・ランキングの図が直接答える形にしている。
 *
 * 器の判定 (T7 §4-1): 会社全体の結論は「1件を読む」なので要約カード(StatTile)と図に任せる。
 * ただし営業所別だけは「所属をまたいで損益を見比べる」ので表 (DataTable) のままにする。
 */

/** 営業所別の列。数字は右揃え・単位は見出しに出し、セルには入れない (T7 §4-4) */
const DEPOT_COLUMNS: readonly DataTableColumn<DepotAggregate>[] = [
  { key: "depot", header: "所属", cell: (d) => d.depot },
  { key: "cars", header: "台数", unit: "台", align: "right", priority: "low", cell: (d) => num(d.cars) },
  {
    key: "deficitCars",
    header: "赤字",
    unit: "台",
    align: "right",
    cell: (d) => (
      <span className={d.deficitCars > 0 ? "font-bold text-danger" : "text-ink-muted"}>
        {num(d.deficitCars)}
      </span>
    ),
  },
  { key: "sales", header: "売上", unit: "円", align: "right", priority: "low", cell: (d) => yen(d.sales) },
  {
    key: "profit",
    header: "損益",
    unit: "円",
    align: "right",
    cell: (d) => (
      <span className={`font-bold ${d.profit < 0 ? "text-danger" : "text-ink"}`}>{yen(d.profit)}</span>
    ),
  },
  {
    key: "margin",
    header: "利益率",
    align: "right",
    priority: "low",
    cell: (d) => <span className="text-ink-muted">{pct(d.margin)}</span>,
  },
];
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
      <ScreenHeader screen="/dashboard" />

      {/*
        期間の指定と「いま何を見ているか」は、この画面の数字の前提そのもの。
        スクロールで消えないように帯へ貼る (T7 §2-3)。工程タブが無いので below は既定。
        annual の補助情報行と同じ作り (どちらも帯に集約し、-mt-3 の手書き行は持たない)。
      */}
      <StickyFilterBar
        summary={
          <>
            {data.label}
            {data.isEmpty ? null : (
              <>
                {" ・ "}
                <span className="num">{num(data.vehicleCount)}</span>台
              </>
            )}
          </>
        }
      >
        <PeriodSelect
          basePath="/dashboard"
          from={from}
          to={to}
          presets={presets}
          options={selectableYearMonths(25)}
        />
      </StickyFilterBar>

      {/*
        異常の早期発見: 分析画面から作業画面(チェック)へ気づいた瞬間に橋渡しする。
        0件のときは静かに消え、認知負荷を増やさない。
      */}
      {anomalyCount > 0 && (
        <div className="mb-4">
          <AlertPanel tone="danger" title={`未処理の異常が ${anomalyCount} 件あります`}>
            そのままにすると、この期間の損益に直していない値が混ざったままになります。
            <Link href="/anomaly" className="ml-1 font-semibold text-danger">
              {findScreen("/anomaly")?.label ?? "チェック"}で1件ずつ判定する →
            </Link>
          </AlertPanel>
        </div>
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
              sub={`1kmあたり売上 ${kmPriceLabel(data.salesPerKm)} / 損益分岐 ${num(
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
                <p className="mt-6 text-center text-sm text-ink-muted">
                  この期間はすべての車両が黒字なので、並べる車両がありません。
                  <br />
                  原因の型で見たくなったときは
                  <Link href={`/deficit?ym=${to}`} className="font-semibold text-brand-deep">
                    {findScreen("/deficit")?.label ?? "赤字の理由"}へ
                  </Link>
                  。
                </p>
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
              {/* 器の判定 (T7 §4-1): 所属をまたいで損益を見比べる表なので、表のままにする */}
              <div className="mt-3">
                <DataTable
                  caption="営業所別の台数・売上・損益"
                  columns={DEPOT_COLUMNS}
                  rows={data.depots}
                  rowKey={(d) => d.depot}
                  maxHeight="24rem"
                  empty={
                    <p className="py-6 text-center text-xs text-ink-muted">
                      所属が入っている車両がありません。車両マスタ管理で所属を登録すると、ここに並びます。
                    </p>
                  }
                />
              </div>
            </section>
          )}

          {/* 一段深い分析は既定で畳む。開く前から中身が分かるラベルにする */}
          <details className="group mt-4 card">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-bold text-ink hover:bg-subtle">
              1kmあたり売上の分布を見る
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
              {findScreen("/annual")?.label ?? "年間集計"}を見る →
            </Link>
          </p>
        </>
      )}
    </>
  );
}
