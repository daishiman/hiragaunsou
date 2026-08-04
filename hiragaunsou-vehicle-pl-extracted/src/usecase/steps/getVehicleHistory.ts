import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";
import { kmPrice } from "../../domain/rules/monthlyAggregation";
import { monthLabel, trailingYearMonths } from "../../domain/rules/fiscalPeriod";

/**
 * S2 月次収支表の車両ドリルダウン (モック view-grid.js の openModal に対応)。
 * 単月の経費内訳 + 12ヶ月推移 + 「実力損益」(突発修繕を12ヶ月平均に均した損益) を返す。
 */

/** 実力損益・修繕平均を取る期間 (月数) */
export const HISTORY_MONTHS = 12;

/** 経費内訳の表示順 (モック annual 明細と同じ8区分) */
export const COST_BREAKDOWN_FIELDS = [
  { key: "tollNet", label: "運行費" },
  { key: "fuelTotal", label: "燃料費" },
  { key: "repairTotal", label: "修繕費" },
  { key: "laborTotal", label: "人件費" },
  { key: "insTotal", label: "保険料" },
  { key: "taxTotal", label: "賦課税" },
  { key: "transportTotal", label: "運送費" },
  { key: "adminTotal", label: "一般管理費" },
] as const satisfies readonly { key: keyof VehiclePlCalculated; label: string }[];

export interface VehicleHistoryMonth {
  yearMonth: string;
  label: string;
  sales: number;
  expense: number;
  profit: number;
  km: number;
  repair: number;
  kmPrice: number | null;
  /** その月にこの車両のデータが無いか */
  isMissing: boolean;
}

export interface VehicleHistoryResponse {
  vehicleNo: string;
  yearMonth: string;
  found: boolean;
  current: VehiclePlCalculated | null;
  costBreakdown: { key: string; label: string; value: number }[];
  history: VehicleHistoryMonth[];
  /** 直近12ヶ月の修理費(実費)平均 */
  avgRepair: number;
  /**
   * 実力損益 = 当月損益 + 当月修理費(実費) − 12ヶ月平均修理費。
   * 突発修繕による単月の落ち込みを均して「恒常的に赤字か」を見る指標。
   */
  normalizedProfit: number | null;
}

export class GetVehicleHistoryUseCase {
  constructor(private readonly vehiclePlRepo: VehiclePlRepository) {}

  async execute(vehicleNo: string, yearMonth: string): Promise<VehicleHistoryResponse> {
    const yearMonths = trailingYearMonths(yearMonth, HISTORY_MONTHS);
    const byMonth = await this.vehiclePlRepo.findByYearMonths(yearMonths);

    const history: VehicleHistoryMonth[] = yearMonths.map((ym) => {
      const row = (byMonth.get(ym) ?? []).find((r) => r.no === vehicleNo);
      return {
        yearMonth: ym,
        label: monthLabel(ym),
        sales: row?.sales ?? 0,
        expense: row?.expense ?? 0,
        profit: row?.profit ?? 0,
        km: row?.km ?? 0,
        repair: row?.repair ?? 0,
        kmPrice: row ? kmPrice(row) : null,
        isMissing: row === undefined,
      };
    });

    const current = (byMonth.get(yearMonth) ?? []).find((r) => r.no === vehicleNo) ?? null;

    // 平均はデータのある月だけで取る (未取込月を0円として薄めない)
    const presentMonths = history.filter((h) => !h.isMissing);
    const avgRepair = presentMonths.length
      ? presentMonths.reduce((sum, h) => sum + h.repair, 0) / presentMonths.length
      : 0;

    return {
      vehicleNo,
      yearMonth,
      found: current !== null,
      current,
      costBreakdown: current
        ? COST_BREAKDOWN_FIELDS.map((f) => ({
            key: f.key,
            label: f.label,
            value: Number(current[f.key]) || 0,
          }))
        : [],
      history,
      avgRepair,
      normalizedProfit: current ? current.profit + current.repair - avgRepair : null,
    };
  }
}
