import type {
  AnnualReferenceRepository,
  VehiclePlRepository,
} from "../../domain/repositories/VehiclePlRepository";
import type { RateMasterRepository } from "../../domain/repositories/MasterRepository";
import {
  monthTotals,
  sumMonthTotals,
  marginOf,
  costPerKm,
  salesPerKm,
  type MonthTotals,
} from "../../domain/rules/monthlyAggregation";
import {
  aggregateByDepot,
  aggregateByVehicle,
  costBreakdown,
  deficitRanking,
  diffRatio,
  monthBefore,
  periodLabel,
  periodYearMonths,
  previousYearOf,
  type CostSlice,
  type DepotAggregate,
  type VehicleAggregate,
} from "../../domain/rules/periodAggregation";
import { kmPriceBuckets, type DeficitThresholds, type KmPriceBucket } from "../../domain/rules/deficitClassification";
import { monthLabel } from "../../domain/rules/fiscalPeriod";

/**
 * 経営ダッシュボード(任意期間版)のユースケース。
 *
 * 既存の GetDashboardUseCase は単月しか見られなかった。
 * 「今月いくらだったか」ではなく「この数ヶ月でどう動いているか / どの車が食っているか」を
 * 1画面で答えるために、月次推移・対前年・経費構成・赤字ランキング・営業所別を
 * まとめて組み立てる。D1のサブリクエスト上限を避けるため、収支表の読み出しは
 * 当期・前年の2回 (findByYearMonths) に固定する。
 */

/** 赤字ランキングの表示件数。全部出すと読む気が失せるので上位だけ。 */
export const DEFICIT_RANKING_LIMIT = 10;

export interface PeriodMonthRow {
  yearMonth: string;
  /** 「5月」形式の短縮ラベル (グラフの目盛り用) */
  label: string;
  totals: MonthTotals;
  margin: number | null;
  /** 同月の前年実績の損益 (無ければ null)。推移グラフの参照線に使う。 */
  prevProfit: number | null;
  prevSales: number | null;
  isEmpty: boolean;
}

export interface PeriodPrevTotals {
  sales: number;
  expense: number;
  profit: number;
  /** actual = 収支表に前年の実データがある / reference = 年間集計シートの転記値 */
  source: "actual" | "reference";
}

export interface PeriodOverviewResponse {
  from: string;
  to: string;
  yearMonths: string[];
  /** 「2026年3月〜2026年5月 (3ヶ月)」形式の見出し */
  label: string;
  months: PeriodMonthRow[];
  totals: MonthTotals;
  margin: number | null;
  costPerKm: number | null;
  salesPerKm: number | null;
  thresholds: DeficitThresholds;
  kmPriceBuckets: KmPriceBucket[];
  costSlices: CostSlice[];
  deficitRanking: VehicleAggregate[];
  depots: DepotAggregate[];
  /** 期間中に1度でも実績のあった車両数 */
  vehicleCount: number;
  /** 期間通算で赤字の車両数 */
  deficitCount: number;
  prev: PeriodPrevTotals | null;
  salesDiffRatio: number | null;
  profitDiffRatio: number | null;
  /** 期間内の最新月を、その1ヶ月前と比べた増減率 (急な悪化に前年比より早く気づくため) */
  salesMomDiffRatio: number | null;
  profitMomDiffRatio: number | null;
  isEmpty: boolean;
}

export class GetPeriodOverviewUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly rateRepo: RateMasterRepository,
    private readonly annualRefRepo: AnnualReferenceRepository,
  ) {}

  async execute(from: string, to: string): Promise<PeriodOverviewResponse> {
    const yearMonths = periodYearMonths(from, to);
    const prevYearMonths = previousYearOf(yearMonths);
    const thresholds = await this.rateRepo.getDeficitThresholds(to);

    if (yearMonths.length === 0) {
      return this.empty(from, to, thresholds);
    }

    const byMonth = await this.vehiclePlRepo.findByYearMonths(yearMonths);
    const prevByMonth = await this.vehiclePlRepo.findByYearMonths(prevYearMonths);

    const rows = yearMonths.flatMap((ym) => byMonth.get(ym) ?? []);
    const totals = sumMonthTotals(yearMonths.map((ym) => monthTotals(byMonth.get(ym) ?? [])));

    // 前年: まず収支表の実データ。無ければ年間集計シートの前年実績で補う。
    // どちらも無いときは null にして「0円だった」と誤読させない。
    const prev = await this.resolvePrev(prevYearMonths, prevByMonth);

    const prevProfitByMonth = new Map<string, number>();
    const prevSalesByMonth = new Map<string, number>();
    for (const [i, prevYm] of prevYearMonths.entries()) {
      const ym = yearMonths[i];
      if (ym === undefined || prevYm === undefined) continue;
      const prevRows = prevByMonth.get(prevYm) ?? [];
      if (prevRows.length === 0) continue;
      const t = monthTotals(prevRows);
      prevProfitByMonth.set(ym, t.profit);
      prevSalesByMonth.set(ym, t.sales);
    }

    const months: PeriodMonthRow[] = yearMonths.map((ym) => {
      const monthRows = byMonth.get(ym) ?? [];
      const t = monthTotals(monthRows);
      return {
        yearMonth: ym,
        label: monthLabel(ym),
        totals: t,
        margin: marginOf(t),
        prevProfit: prevProfitByMonth.get(ym) ?? null,
        prevSales: prevSalesByMonth.get(ym) ?? null,
        isEmpty: monthRows.length === 0,
      };
    });

    const vehicles = aggregateByVehicle(byMonth);

    // 前月比: 期間全体ではなく「最新月」だけを1ヶ月前と比べる。期間が3ヶ月・12ヶ月でも
    // 直近の勢いに一番早く気づけるのはこの単月同士の比較のため。
    const lastMonth = months[months.length - 1];
    let momTotals: MonthTotals | null = null;
    if (lastMonth !== undefined) {
      const momYm = monthBefore(lastMonth.yearMonth);
      const momRows = byMonth.has(momYm)
        ? (byMonth.get(momYm) ?? [])
        : [...((await this.vehiclePlRepo.findByYearMonths([momYm])).get(momYm) ?? [])];
      if (momRows.length > 0) momTotals = monthTotals(momRows);
    }

    return {
      from,
      to,
      yearMonths,
      label: periodLabel(yearMonths),
      months,
      totals,
      margin: marginOf(totals),
      costPerKm: costPerKm(totals),
      salesPerKm: salesPerKm(totals),
      thresholds,
      kmPriceBuckets: kmPriceBuckets(rows, thresholds.breakEvenKmPrice),
      costSlices: costBreakdown(totals),
      deficitRanking: deficitRanking(vehicles, DEFICIT_RANKING_LIMIT),
      depots: aggregateByDepot(vehicles),
      vehicleCount: vehicles.length,
      deficitCount: vehicles.filter((v) => v.profit < 0).length,
      prev,
      salesDiffRatio: prev === null ? null : diffRatio(totals.sales, prev.sales),
      profitDiffRatio: prev === null ? null : diffRatio(totals.profit, prev.profit),
      salesMomDiffRatio:
        lastMonth === undefined || momTotals === null
          ? null
          : diffRatio(lastMonth.totals.sales, momTotals.sales),
      profitMomDiffRatio:
        lastMonth === undefined || momTotals === null
          ? null
          : diffRatio(lastMonth.totals.profit, momTotals.profit),
      isEmpty: rows.length === 0,
    };
  }

  private async resolvePrev(
    prevYearMonths: readonly string[],
    prevByMonth: ReadonlyMap<string, readonly { sales: number; expense: number; profit: number }[]>,
  ): Promise<PeriodPrevTotals | null> {
    const actualRows = prevYearMonths.flatMap((ym) => [...(prevByMonth.get(ym) ?? [])]);
    if (actualRows.length > 0) {
      return {
        sales: actualRows.reduce((s, r) => s + r.sales, 0),
        expense: actualRows.reduce((s, r) => s + r.expense, 0),
        profit: actualRows.reduce((s, r) => s + r.profit, 0),
        source: "actual",
      };
    }

    const refs = await this.annualRefRepo.findByKind("prev_year_actual", prevYearMonths);
    if (refs.length === 0) return null;
    const sales = refs.reduce((s, r) => s + r.sales, 0);
    const expense = refs.reduce((s, r) => s + r.expense, 0);
    return { sales, expense, profit: sales - expense, source: "reference" };
  }

  private empty(from: string, to: string, thresholds: DeficitThresholds): PeriodOverviewResponse {
    const totals = monthTotals([]);
    return {
      from,
      to,
      yearMonths: [],
      label: periodLabel([]),
      months: [],
      totals,
      margin: null,
      costPerKm: null,
      salesPerKm: null,
      thresholds,
      kmPriceBuckets: kmPriceBuckets([], thresholds.breakEvenKmPrice),
      costSlices: costBreakdown(totals),
      deficitRanking: [],
      depots: [],
      vehicleCount: 0,
      deficitCount: 0,
      prev: null,
      salesDiffRatio: null,
      profitDiffRatio: null,
      salesMomDiffRatio: null,
      profitMomDiffRatio: null,
      isEmpty: true,
    };
  }
}
