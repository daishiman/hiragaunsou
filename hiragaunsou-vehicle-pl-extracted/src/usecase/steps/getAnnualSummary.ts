import type {
  AnnualReferenceRepository,
  VehiclePlRepository,
} from "../../domain/repositories/VehiclePlRepository";
import {
  monthTotals,
  sumMonthTotals,
  costPerKm,
  salesPerKm,
  marginOf,
  type MonthTotals,
} from "../../domain/rules/monthlyAggregation";
import {
  fiscalYearMonths,
  fiscalYearOf,
  monthLabel,
  previousFiscalYearMonths,
} from "../../domain/rules/fiscalPeriod";

/**
 * S8 年間集計・対前年 ユースケース (モック view-annual.js に対応)。
 * 12ヶ月推移 / 経費内訳明細 / 対前年 / 現行Excel年間集計シートとの自動突合 を1回のD1アクセスで組み立てる。
 */

/** 突合の許容差 (円)。これを超えたら「要確認」として画面に出す。 */
export const RECONCILIATION_TOLERANCE = 1000;

export interface AnnualMonthRow {
  yearMonth: string;
  label: string;
  totals: MonthTotals;
  margin: number | null;
  costPerKm: number | null;
  salesPerKm: number | null;
  /** その月のデータが未取込か */
  isEmpty: boolean;
}

export interface AnnualComparisonRow {
  label: string;
  yearMonth: string;
  sales: number;
  expense: number;
  profit: number;
  prevSales: number | null;
  prevExpense: number | null;
  prevProfit: number | null;
  salesDiff: number | null;
  profitDiff: number | null;
}

export interface ReconciliationRow {
  label: string;
  yearMonth: string;
  systemSales: number;
  sheetSales: number | null;
  salesGap: number | null;
  systemExpense: number;
  sheetExpense: number | null;
  expenseGap: number | null;
  hasGap: boolean;
}

export interface AnnualSummaryResponse {
  /** 期の開始年 (6月始まり) */
  fiscalYear: number;
  yearMonths: string[];
  months: AnnualMonthRow[];
  total: MonthTotals;
  totalMargin: number | null;
  totalCostPerKm: number | null;
  totalSalesPerKm: number | null;
  comparison: AnnualComparisonRow[];
  comparisonPrevTotal: { sales: number; expense: number; profit: number } | null;
  reconciliation: ReconciliationRow[];
  reconciliationGapCount: number;
  isEmpty: boolean;
}

export class GetAnnualSummaryUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly annualRefRepo: AnnualReferenceRepository,
  ) {}

  async execute(yearMonth: string): Promise<AnnualSummaryResponse> {
    const yearMonths = fiscalYearMonths(yearMonth);
    const prevYearMonths = previousFiscalYearMonths(yearMonth);

    const byMonth = await this.vehiclePlRepo.findByYearMonths(yearMonths);
    const prevActuals = await this.annualRefRepo.findByKind("prev_year_actual", prevYearMonths);
    const sheetValues = await this.annualRefRepo.findByKind("excel_annual_sheet", yearMonths);

    const prevMap = new Map(prevActuals.map((r) => [r.yearMonth, r]));
    const sheetMap = new Map(sheetValues.map((r) => [r.yearMonth, r]));

    const months: AnnualMonthRow[] = yearMonths.map((ym) => {
      const rows = byMonth.get(ym) ?? [];
      const totals = monthTotals(rows);
      return {
        yearMonth: ym,
        label: monthLabel(ym),
        totals,
        margin: marginOf(totals),
        costPerKm: costPerKm(totals),
        salesPerKm: salesPerKm(totals),
        isEmpty: rows.length === 0,
      };
    });

    const total = sumMonthTotals(months.map((m) => m.totals));

    const comparison: AnnualComparisonRow[] = months.map((m, i) => {
      const prevYm = prevYearMonths[i];
      const prev = prevYm === undefined ? undefined : prevMap.get(prevYm);
      const prevProfit = prev ? prev.sales - prev.expense : null;
      return {
        label: m.label,
        yearMonth: m.yearMonth,
        sales: m.totals.sales,
        expense: m.totals.expense,
        profit: m.totals.profit,
        prevSales: prev?.sales ?? null,
        prevExpense: prev?.expense ?? null,
        prevProfit,
        salesDiff: prev ? m.totals.sales - prev.sales : null,
        profitDiff: prevProfit === null ? null : m.totals.profit - prevProfit,
      };
    });

    const comparisonPrevTotal = prevActuals.length
      ? prevActuals.reduce(
          (acc, r) => ({
            sales: acc.sales + r.sales,
            expense: acc.expense + r.expense,
            profit: acc.profit + (r.sales - r.expense),
          }),
          { sales: 0, expense: 0, profit: 0 },
        )
      : null;

    const reconciliation: ReconciliationRow[] = months.map((m) => {
      const sheet = sheetMap.get(m.yearMonth) ?? null;
      const salesGap = sheet ? m.totals.sales - sheet.sales : null;
      const expenseGap = sheet ? m.totals.expense - sheet.expense : null;
      return {
        label: m.label,
        yearMonth: m.yearMonth,
        systemSales: m.totals.sales,
        sheetSales: sheet?.sales ?? null,
        salesGap,
        systemExpense: m.totals.expense,
        sheetExpense: sheet?.expense ?? null,
        expenseGap,
        hasGap:
          (salesGap !== null && Math.abs(salesGap) > RECONCILIATION_TOLERANCE) ||
          (expenseGap !== null && Math.abs(expenseGap) > RECONCILIATION_TOLERANCE),
      };
    });

    return {
      fiscalYear: fiscalYearOf(yearMonth),
      yearMonths,
      months,
      total,
      totalMargin: marginOf(total),
      totalCostPerKm: costPerKm(total),
      totalSalesPerKm: salesPerKm(total),
      comparison,
      comparisonPrevTotal,
      reconciliation,
      reconciliationGapCount: reconciliation.filter((r) => r.hasGap).length,
      isEmpty: months.every((m) => m.isEmpty),
    };
  }
}
