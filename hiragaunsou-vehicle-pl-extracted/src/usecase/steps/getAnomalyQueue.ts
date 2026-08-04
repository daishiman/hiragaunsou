import type {
  ReviewFlagRepository,
  VehiclePlRepository,
} from "../../domain/repositories/VehiclePlRepository";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";
import { monthLabel, trailingYearMonths } from "../../domain/rules/fiscalPeriod";

/**
 * S3 異常値チェック ユースケース (モック view-anomaly.js に対応)。
 *
 * 一覧を眺めて考えさせるのではなく、「1件ずつ・推奨つきで・戻せる」判定キューにする。
 * 各件に直近12ヶ月の同一項目の推移と中央値を添え、当月値が平常からどれだけ外れているかを見せる。
 */

/** 推移グラフ・中央値の算出期間 (月数) */
export const SPARK_MONTHS = 12;

export type AnomalyPriority = "高" | "中" | "低";
/** 推奨する判定 (corrected = 入力ミスとして直しに送る / approved = これで正しいと確定) */
export type AnomalyRecommendation = "corrected" | "approved";

export interface AnomalySparkPoint {
  yearMonth: string;
  label: string;
  value: number | null;
}

export interface AnomalyQueueItem {
  id: string;
  vehicleNo: string | null;
  field: string | null;
  type: string;
  message: string;
  priority: AnomalyPriority;
  /** 当月の値 (該当車両・該当項目が引けなければ null) */
  value: number | null;
  /** 直近12ヶ月の中央値 (平常値の目安) */
  median: number | null;
  /** 中央値に対する倍率 (中央値0・不明なら null) */
  ratioToMedian: number | null;
  spark: AnomalySparkPoint[];
  recommendation: AnomalyRecommendation;
}

export interface AnomalyQueueResponse {
  yearMonth: string;
  items: AnomalyQueueItem[];
  totalOpen: number;
  /** 全件判定済み (締め確定に進める状態) か */
  isDone: boolean;
}

const PRIORITY_BY_SEVERITY: Record<string, AnomalyPriority> = {
  critical: "高",
  warning: "中",
  info: "低",
};

const PRIORITY_ORDER: Record<AnomalyPriority, number> = { 高: 0, 中: 1, 低: 2 };

/** 低優先度は「これで正しい」を、それ以外は「入力ミス」を推奨する (モック recommendOf と同じ) */
export function recommendationOf(priority: AnomalyPriority): AnomalyRecommendation {
  return priority === "低" ? "approved" : "corrected";
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

function numericField(row: VehiclePlCalculated | undefined, field: string | null): number | null {
  if (!row || !field) return null;
  const value = (row as unknown as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class GetAnomalyQueueUseCase {
  constructor(
    private readonly reviewFlagRepo: ReviewFlagRepository,
    private readonly vehiclePlRepo: VehiclePlRepository,
  ) {}

  async execute(yearMonth: string): Promise<AnomalyQueueResponse> {
    const flags = await this.reviewFlagRepo.findOpenByYearMonth(yearMonth);
    const open = flags.filter((f) => f.status === "open");

    const yearMonths = trailingYearMonths(yearMonth, SPARK_MONTHS);
    const byMonth = await this.vehiclePlRepo.findByYearMonths(yearMonths);

    const items: AnomalyQueueItem[] = open.map((flag) => {
      const priority = PRIORITY_BY_SEVERITY[flag.severity] ?? "中";

      const spark: AnomalySparkPoint[] = yearMonths.map((ym) => {
        const row = (byMonth.get(ym) ?? []).find((r) => r.no === flag.vehicleNo);
        return { yearMonth: ym, label: monthLabel(ym), value: numericField(row, flag.field) };
      });

      // 当月は判定対象なので中央値の母集団から外す (異常値自身に平常値を引っ張らせない)
      const past = spark
        .filter((p) => p.yearMonth !== yearMonth && p.value !== null)
        .map((p) => p.value as number);
      const median = medianOf(past);
      const value = spark.find((p) => p.yearMonth === yearMonth)?.value ?? null;

      return {
        id: flag.id,
        vehicleNo: flag.vehicleNo,
        field: flag.field,
        type: flag.type,
        message: flag.message,
        priority,
        value,
        median,
        ratioToMedian: value !== null && median !== null && median !== 0 ? value / median : null,
        spark,
        recommendation: recommendationOf(priority),
      };
    });

    items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

    return {
      yearMonth,
      items,
      totalOpen: items.length,
      isDone: items.length === 0,
    };
  }
}
