import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { RateMasterRepository } from "../../domain/repositories/MasterRepository";
import {
  monthTotals,
  marginOf,
  costPerKm,
  salesPerKm,
  type MonthTotals,
} from "../../domain/rules/monthlyAggregation";
import {
  kmPriceBuckets,
  type DeficitThresholds,
  type KmPriceBucket,
} from "../../domain/rules/deficitClassification";

/**
 * S7 経営ダッシュボード ユースケース (モック view-dashboard.js に対応)。
 * KPI 4枚 + 「利益の構造」(黒字車の利益合計 / 赤字車の損失合計 / 全社損益) + km単価の分布。
 */
export interface DashboardResponse {
  yearMonth: string;
  totals: MonthTotals;
  /** 利益率 (売上0なら null) */
  margin: number | null;
  /** 1kmあたり原価 (走行0なら null) */
  costPerKm: number | null;
  /** 1kmあたり売上 (走行0なら null) */
  salesPerKm: number | null;
  thresholds: DeficitThresholds;
  kmPriceBuckets: KmPriceBucket[];
  isEmpty: boolean;
}

export class GetDashboardUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly rateRepo: RateMasterRepository,
  ) {}

  async execute(yearMonth: string): Promise<DashboardResponse> {
    const rows = await this.vehiclePlRepo.findByYearMonth(yearMonth);
    const thresholds = await this.rateRepo.getDeficitThresholds(yearMonth);
    const totals = monthTotals(rows);

    return {
      yearMonth,
      totals,
      margin: marginOf(totals),
      costPerKm: costPerKm(totals),
      salesPerKm: salesPerKm(totals),
      thresholds,
      kmPriceBuckets: kmPriceBuckets(rows, thresholds.breakEvenKmPrice),
      isEmpty: rows.length === 0,
    };
  }
}
