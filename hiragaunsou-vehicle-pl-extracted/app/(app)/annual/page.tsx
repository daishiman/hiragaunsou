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
  type AnnualComparisonRow,
  type ReconciliationRow,
} from "../../../src/usecase/steps/getAnnualSummary";
import type { MonthTotals } from "../../../src/domain/rules/monthlyAggregation";
import { costBreakdown, diffRatio } from "../../../src/domain/rules/periodAggregation";
import { selectableYearMonths } from "../../_lib/yearMonth";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { kmPriceLabel, man, num, pct, yen } from "../../_lib/format";
import type { ReactNode } from "react";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { EmptyState } from "../../_components/EmptyState";
import { StatTile } from "../../_components/StatTile";
import { StickyFilterBar } from "../../_components/StickyFilterBar";
import { AlertPanel } from "../../_components/AlertPanel";
import { Badge } from "../../_components/Badge";
import { DataTable, type DataTableColumn } from "../../_components/DataTable";
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
 * 月別明細の1行。「項目」を行、「月」を列にした表なので、行の中に月ごとの値を持つ。
 * 以前は項目列にだけ手書きの sticky が8箇所ぶら下がっていて、同じページの3つの表で
 * 見出しの挙動が3通りになっていた。DataTable に寄せ、固定は maxHeight による見出し行だけに揃える。
 */
interface DetailRow {
  key: string;
  /** 項目名。円以外の単位はここに全角括弧で書く */
  label: string;
  /** data.months と同じ並びの表示値 */
  values: ReactNode[];
  total: ReactNode;
  /** 合計・小計の行 */
  strong?: boolean;
}

/** マイナスだけ赤くする。単位はセルに入れない (列見出しの unit が持つ) */
function signed(value: number | null): ReactNode {
  return <span className={(value ?? 0) < 0 ? "text-danger" : undefined}>{yen(value)}</span>;
}

/** 前期との月別差額。月をまたいで差額を見比べる表 (T7 §4-1「見比べたい」) */
const COMPARISON_COLUMNS: readonly DataTableColumn<AnnualComparisonRow>[] = [
  { key: "month", header: "月", cell: (c) => <span className="font-medium">{c.label}</span> },
  { key: "sales", header: "売上", unit: "円", align: "right", cell: (c) => yen(c.sales) },
  {
    key: "prevSales",
    header: "前期売上",
    unit: "円",
    align: "right",
    priority: "low",
    cell: (c) => yen(c.prevSales),
  },
  {
    key: "salesDiff",
    header: "売上差",
    unit: "円",
    align: "right",
    cell: (c) => <span className="font-bold">{signed(c.salesDiff)}</span>,
  },
  { key: "profit", header: "損益", unit: "円", align: "right", cell: (c) => signed(c.profit) },
  {
    key: "prevProfit",
    header: "前期損益",
    unit: "円",
    align: "right",
    priority: "low",
    cell: (c) => yen(c.prevProfit),
  },
  {
    key: "profitDiff",
    header: "損益差",
    unit: "円",
    align: "right",
    cell: (c) => <span className="font-bold">{signed(c.profitDiff)}</span>,
  },
];

/** Excel年間集計シートとの突合。月ごとに本システムとExcelを見比べる表 */
const RECONCILIATION_COLUMNS: readonly DataTableColumn<ReconciliationRow>[] = [
  {
    key: "month",
    header: "月",
    cell: (r) => (
      <Link
        href={`/grid?ym=${encodeURIComponent(r.yearMonth)}`}
        className="font-medium text-brand-deep hover:underline"
      >
        {r.label}
      </Link>
    ),
  },
  {
    key: "systemSales",
    header: "本システム売上",
    unit: "円",
    align: "right",
    cell: (r) => yen(r.systemSales),
  },
  { key: "sheetSales", header: "Excel売上", unit: "円", align: "right", cell: (r) => yen(r.sheetSales) },
  {
    key: "salesGap",
    header: "売上差",
    unit: "円",
    align: "right",
    cell: (r) => <span className="font-bold">{yen(r.salesGap)}</span>,
  },
  {
    key: "systemExpense",
    header: "本システム経費",
    unit: "円",
    align: "right",
    priority: "low",
    cell: (r) => yen(r.systemExpense),
  },
  {
    key: "sheetExpense",
    header: "Excel経費",
    unit: "円",
    align: "right",
    priority: "low",
    cell: (r) => yen(r.sheetExpense),
  },
  {
    key: "expenseGap",
    header: "経費差",
    unit: "円",
    align: "right",
    cell: (r) => <span className="font-bold">{yen(r.expenseGap)}</span>,
  },
  {
    key: "judge",
    header: "判定",
    cell: (r) =>
      r.sheetSales === null ? (
        <Badge tone="neutral">Excel未登録</Badge>
      ) : r.hasGap ? (
        <Badge tone="danger">要確認</Badge>
      ) : (
        <Badge tone="neutral">一致</Badge>
      ),
  },
];

/**
 * S8 年間集計・対前年。
 *
 * この画面の目的は1つ:「この1期、去年と比べてどうだったか」。
 * 主役は年間損益の1数字で、推移はグラフが答える。
 * 月別の明細表 (12列×8行) は読み物なので既定で畳み、開く前に中身が分かるラベルを付ける。
 *
 * 器の判定 (T7 §4-1): 結論の数字は「1件を読む」なので要約カード、
 * 月別明細・前期との差額・Excel突合の3つは「月をまたいで値を見比べる」ので表のままにする。
 * 3つとも DataTable に寄せ、見出しの固定の仕方を1通りに揃える。
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

  /*
    月別明細は「項目」が行、「月」が列。列の数は取り込んだ月の数で決まるので実データから組み立てる。
    単位は列見出し (円) に出し、円以外の行だけ項目名に単位を書く。セルには単位を入れない。
  */
  const detailColumns: readonly DataTableColumn<DetailRow>[] = [
    {
      key: "item",
      header: "項目",
      unit: "円",
      headClassName: "min-w-[9rem]",
      cell: (r) => <span className="font-medium text-ink">{r.label}</span>,
    },
    ...data.months.map((m, i) => ({
      key: m.yearMonth,
      header: m.label,
      align: "right" as const,
      cell: (r: DetailRow) => r.values[i],
    })),
    {
      key: "total",
      header: "年間合計",
      align: "right" as const,
      cell: (r: DetailRow) => <span className="font-bold">{r.total}</span>,
    },
  ];

  const detailRows: DetailRow[] = [
    ...COST_ROWS.map(([label, key]) => ({
      key,
      label,
      values: data.months.map((m) => (m.isEmpty ? "—" : yen(m.totals[key]))),
      total: yen(data.total[key]),
    })),
    {
      key: "expense",
      label: "経費計",
      strong: true,
      values: data.months.map((m) => (m.isEmpty ? "—" : yen(m.totals.expense))),
      total: yen(data.total.expense),
    },
    {
      key: "sales",
      label: "売上",
      values: data.months.map((m) => (m.isEmpty ? "—" : yen(m.totals.sales))),
      total: yen(data.total.sales),
    },
    {
      key: "profit",
      label: "損益",
      strong: true,
      values: data.months.map((m) => (m.isEmpty ? "—" : signed(m.totals.profit))),
      total: signed(data.total.profit),
    },
    {
      key: "km",
      label: "走行距離（km）",
      values: data.months.map((m) => (m.isEmpty ? "—" : num(m.totals.km, 1))),
      total: num(data.total.km, 1),
    },
    {
      key: "costPerKm",
      label: "1kmあたり原価（円/km）",
      values: data.months.map((m) => num(m.costPerKm, 1)),
      total: num(data.totalCostPerKm, 1),
    },
    {
      key: "salesPerKm",
      label: "1kmあたり売上（円/km）",
      values: data.months.map((m) => num(m.salesPerKm, 1)),
      total: num(data.totalSalesPerKm, 1),
    },
  ];

  return (
    <>
      <ScreenHeader screen="/annual" />

      {/*
        対象年月・見ている期・取込済の件数は、この画面の数字の前提そのもの。
        手書きの補助情報行 (-mt-3) をやめ、dashboard と同じく帯へ集約して貼る (T7 §2-2 / §2-3)。
        工程タブの無い画面なので below は既定の "header"。
      */}
      <StickyFilterBar
        summary={
          <>
            取込済{" "}
            <span className="num">
              {importedCount}/{data.months.length}
            </span>
            ヶ月
          </>
        }
      >
        <YearMonthSelect basePath="/annual" value={yearMonth} options={selectableYearMonths(25)} />
        <span className="text-xs font-semibold text-ink-muted">
          <span className="num">{data.fiscalYear}</span>年6月〜
          <span className="num">{data.fiscalYear + 1}</span>年5月（1期）
        </span>
        <Link href={`/annual?ym=${prevFiscalAnchor}`} className="btn btn-quiet btn-sm pressable">
          前の期を見る
        </Link>
        <Link href={`/annual?ym=${nextFiscalAnchor}`} className="btn btn-quiet btn-sm pressable">
          次の期を見る
        </Link>
      </StickyFilterBar>

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
              sub={`1kmあたり売上 ${kmPriceLabel(data.totalSalesPerKm)}`}
            />
          </div>

          {/* Excel突合は「件数」ではなく状態が主。色だけで伝えず文字ラベルを付ける (AlertPanel に統一) */}
          <div className="mt-3">
            <AlertPanel
              tone={!hasSheet ? "info" : data.reconciliationGapCount > 0 ? "caution" : "success"}
              title={
                !hasSheet
                  ? "Excel年間集計シートとの突合：未登録"
                  : data.reconciliationGapCount > 0
                    ? `Excel年間集計シートとの突合：要確認 ${data.reconciliationGapCount}ヶ月`
                    : "Excel年間集計シートとの突合：全月一致"
              }
            >
              {!hasSheet
                ? "Excel年間集計シートの値を登録すると、月ごとに自動で照合します。"
                : "月合計の差の内訳は車番別でしか読めません。"}{" "}
              {/* 月合計の差の内訳は車番別でしか読めない。同じ月の月次収支表へ渡す。 */}
              <Link
                href={`/grid?ym=${encodeURIComponent(yearMonth)}`}
                className="font-semibold text-brand-deep hover:underline"
              >
                車番別の差異を見る →
              </Link>
            </AlertPanel>
          </div>

          <section className="mt-4 card p-5">
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

          <section className="mt-4 card p-5">
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

          <section className="mt-4 card p-5">
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
          <details className="group mt-4 card">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-bold text-ink hover:bg-subtle">
              月別の明細を見る
              <span className="ml-2 text-xs font-normal text-ink-muted">
                経費8区分・売上・損益・走行距離・1kmあたりの原価と売上を月ごとに
              </span>
            </summary>
            <div className="border-t border-line">
              <DataTable
                caption="月別の経費内訳明細（円）"
                columns={detailColumns}
                rows={detailRows}
                rowKey={(r) => r.key}
                maxHeight="28rem"
                rowClassName={(r) => (r.strong ? "bg-subtle font-bold" : undefined)}
                empty={
                  <p className="px-5 py-6 text-xs text-ink-muted">
                    この期はまだ1ヶ月も取り込まれていないため、明細が作れません。データ取込で月次データを取り込んでください。
                  </p>
                }
              />
            </div>
          </details>

          <details className="group mt-4 card">
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
              <div className="border-t border-line">
                <DataTable
                  caption="前期との月別差額"
                  columns={COMPARISON_COLUMNS}
                  rows={data.comparison}
                  rowKey={(c) => c.yearMonth}
                  maxHeight="28rem"
                  empty={
                    <p className="px-5 py-6 text-xs text-ink-muted">
                      比べられる月がありません。月次データを取り込むと、月ごとの差額が出ます。
                    </p>
                  }
                />
              </div>
            )}
          </details>

          {/* 差がある月は初手で開く。「一致」の表は開かない (読む価値が無い) */}
          <details
            open={data.reconciliationGapCount > 0}
            className="group mt-4 card"
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
              <div className="border-t border-line">
                <DataTable
                  caption="Excel年間集計シートとの月別突合"
                  columns={RECONCILIATION_COLUMNS}
                  rows={data.reconciliation}
                  rowKey={(r) => r.yearMonth}
                  maxHeight="28rem"
                  rowClassName={(r) => (r.hasGap ? "bg-caution-soft" : undefined)}
                  empty={
                    <p className="px-5 py-6 text-xs text-ink-muted">
                      照合できる月がありません。Excel年間集計シートの値を登録すると、月ごとに自動で照合します。
                    </p>
                  }
                />
              </div>
            )}
          </details>

          <p className="mt-4 text-center text-xs text-ink-muted">
            <Link href="/dashboard" className="font-semibold text-brand-deep hover:underline">
              期間を指定して見る（ダッシュボード）→
            </Link>
          </p>
        </>
      )}
    </>
  );
}
