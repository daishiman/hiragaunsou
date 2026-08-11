import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { RateMasterRepository } from "../../domain/repositories/MasterRepository";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";
import { kmPrice } from "../../domain/rules/monthlyAggregation";
import {
  classifyDeficit,
  DEFICIT_CATEGORY_ORDER,
  type DeficitCategory,
  type DeficitThresholds,
} from "../../domain/rules/deficitClassification";

/**
 * S9 赤字の理由(3分類) ユースケース (モック view-deficit.js に対応)。
 * 「赤字か黒字か」で止めず、突発修繕型 / 単価・効率型 / 遊休・低稼働型 に分けて打ち手に繋げる。
 */
export interface DeficitVehicle {
  vehicleNo: string;
  type: string;
  depot: string;
  driver: string | null;
  sales: number;
  expense: number;
  profit: number;
  km: number;
  /** 突発修繕型で見る修理費(実費) */
  repair: number;
  /** 単価・効率型で見る km単価 (走行0なら null) */
  kmPrice: number | null;
  /** 遊休・低稼働型で見る固定費の流出 */
  fixed: number;
}

export interface DeficitGroupResult {
  category: DeficitCategory;
  title: string;
  description: string;
  action: string;
  /** その分類で注目する追加列のラベル */
  extraColumnLabel: string;
  vehicles: DeficitVehicle[];
  lossTotal: number;
}

export interface DeficitAnalysisResponse {
  yearMonth: string;
  thresholds: DeficitThresholds;
  groups: DeficitGroupResult[];
  deficitCount: number;
  lossTotal: number;
  isEmpty: boolean;
}

const META: Record<
  DeficitCategory,
  { title: string; description: string; action: string; extraColumnLabel: string }
> = {
  repair: {
    title: "突発修繕型",
    description: "単月に大きな修理費が乗ったことで赤字になった車両。恒常的な赤字ではない可能性が高い。",
    action: "修理費を12ヶ月平均に均した「実力損益」で再評価する。車検・大規模修繕の計上月を確認する。",
    extraColumnLabel: "修理費(実費)",
  },
  price: {
    title: "単価・効率型",
    description: "稼働はしているのに赤字。運賃単価か走行効率が損益分岐に届いていない。",
    action: "1kmあたり売上が損益分岐を下回る荷主・路線を特定し、値上げ交渉または配車の組み替えを検討する。",
    extraColumnLabel: "1kmあたり売上",
  },
  idle: {
    title: "遊休・低稼働型",
    description: "そもそも売上が立っていない。稼働していない期間の固定費だけが流出している。",
    action: "休車・売却・運転者配置の見直し。車検切れ/長期修理入庫の有無を確認する。",
    extraColumnLabel: "固定費の流出",
  },
};

function toDeficitVehicle(row: VehiclePlCalculated): DeficitVehicle {
  return {
    vehicleNo: row.no,
    type: row.type,
    depot: row.depot,
    driver: row.driver,
    sales: row.sales,
    expense: row.expense,
    profit: row.profit,
    km: row.km,
    repair: row.repair,
    kmPrice: kmPrice(row),
    fixed: row.fixed,
  };
}

export class GetDeficitAnalysisUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly rateRepo: RateMasterRepository,
  ) {}

  async execute(yearMonth: string): Promise<DeficitAnalysisResponse> {
    const rows = await this.vehiclePlRepo.findByYearMonth(yearMonth);
    const thresholds = await this.rateRepo.getDeficitThresholds(yearMonth);
    const classified = classifyDeficit(rows, thresholds);

    const groups: DeficitGroupResult[] = DEFICIT_CATEGORY_ORDER.map((category) => {
      // 損失の大きい順 (打ち手の優先順位そのもの)
      const vehicles = classified[category]
        .map(toDeficitVehicle)
        .sort((a, b) => a.profit - b.profit);
      return {
        category,
        ...META[category],
        vehicles,
        lossTotal: vehicles.reduce((sum, v) => sum + v.profit, 0),
      };
    });

    const deficitCount = groups.reduce((sum, g) => sum + g.vehicles.length, 0);
    return {
      yearMonth,
      thresholds,
      groups,
      deficitCount,
      lossTotal: groups.reduce((sum, g) => sum + g.lossTotal, 0),
      isEmpty: rows.length === 0,
    };
  }
}
