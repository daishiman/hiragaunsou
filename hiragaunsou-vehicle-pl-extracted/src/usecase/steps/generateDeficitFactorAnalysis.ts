import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { UsageLogRepository } from "../../domain/repositories/UsageLogRepository";
import type {
  DeficitFactorAnalysisRecord,
  DeficitFactorAnalysisRepository,
} from "../../domain/repositories/DeficitFactorAnalysisRepository";
import type { DeficitFactorAnalysisAiPort } from "../../domain/services/DeficitFactorAnalysisAiPort";
import { classifyDeficit, DEFICIT_CATEGORY_ORDER, type DeficitCategory } from "../../domain/rules/deficitClassification";
import type { RateMasterRepository } from "../../domain/repositories/MasterRepository";
import type { VehiclePlCalculated } from "../../domain/rules/vehiclePlCalculation";

/**
 * S9 赤字の理由(3分類)画面の「AI分析する」ボタンから起動するユースケース。
 *
 * 対象月の赤字車両を月単位でまとめて1回のAI呼び出しに渡し(レコード単位で呼ばず
 * レート制限・コストを抑える設計)、結果をD1にキャッシュする。
 * キャッシュは「分析時点の損益」ごと持ち、損益が動いた車両は分析し直す。
 */
export interface GenerateDeficitFactorAnalysisInput {
  yearMonth: string;
  requestedBy: string | null;
}

export interface GenerateDeficitFactorAnalysisResult {
  results: DeficitFactorAnalysisRecord[];
  /** 今回AI呼び出しの対象になった(=未分析だった)車両数 */
  analyzedCount: number;
}

const USAGE_KIND = "deficit_factor_analysis";

/**
 * 分析時点の損益と現在の損益が「同じ」と見なす幅(円)。
 * 損益は round2 済みなので本来は完全一致するが、1円未満の差でAI呼び出しが
 * 再発生する方が実害が大きい。1円以上動いたら説明文の根拠が変わったと見なす。
 */
const PROFIT_DRIFT_TOLERANCE_YEN = 1;

export class GenerateDeficitFactorAnalysisUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly analysisRepo: DeficitFactorAnalysisRepository,
    private readonly aiPort: DeficitFactorAnalysisAiPort,
    private readonly usageLogRepo: UsageLogRepository,
    private readonly rateMasterRepo: RateMasterRepository,
  ) {}

  async execute(input: GenerateDeficitFactorAnalysisInput): Promise<GenerateDeficitFactorAnalysisResult> {
    const rows = await this.vehiclePlRepo.findByYearMonth(input.yearMonth);
    // 閾値は rate_master から取る。引数を省くと DEFAULT_DEFICIT_THRESHOLDS が黙って使われ、
    // 「閾値をマスタで差し替える」という設計が呼び出し側だけで無効になる。
    const thresholds = await this.rateMasterRepo.getDeficitThresholds(input.yearMonth);
    const groups = classifyDeficit(rows, thresholds);
    const deficitVehicles: { vehicle: VehiclePlCalculated; ruleCategory: DeficitCategory }[] =
      DEFICIT_CATEGORY_ORDER.flatMap((category) =>
        groups[category].map((vehicle) => ({ vehicle, ruleCategory: category })),
      );

    const existing = await this.analysisRepo.findByYearMonth(input.yearMonth);
    const analyzedByVehicleNo = new Map(existing.map((r) => [r.vehicleNo, r]));
    const targets = deficitVehicles.filter((t) =>
      isStale(analyzedByVehicleNo.get(t.vehicle.no), t.vehicle.profit),
    );

    if (targets.length === 0) {
      return { results: existing, analyzedCount: 0 };
    }

    const { results, usage } = await this.aiPort.analyze({ yearMonth: input.yearMonth, targets });

    await this.usageLogRepo.record({
      kind: USAGE_KIND,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      recordedBy: input.requestedBy,
      detail: { yearMonth: input.yearMonth, vehicleCount: targets.length },
    });

    // 分析に渡した損益をそのまま添えて保存する。AIが返した車番から引き直すのは、
    // 結果の順序や件数が targets と一致する保証がないため。
    const profitByVehicleNo = new Map(targets.map((t) => [t.vehicle.no, t.vehicle.profit]));
    await this.analysisRepo.upsertMany(
      results.map((r) => ({
        vehicleNo: r.vehicleNo,
        yearMonth: input.yearMonth,
        summary: r.summary,
        factors: r.factors,
        model: usage.model,
        profitAtAnalysis: profitByVehicleNo.get(r.vehicleNo) ?? 0,
      })),
      input.requestedBy,
    );

    const merged = await this.analysisRepo.findByYearMonth(input.yearMonth);
    return { results: merged, analyzedCount: targets.length };
  }
}

/**
 * この車両を分析し直す必要があるか。
 *
 * 「分析行が無い」だけでなく「あるが前提の損益が変わった」ときも対象にする。
 * profitAtAnalysis が null なのは列を追加する前に作られたレコードで、
 * 陳腐化しているかを判定できない。判定できないものを有効なキャッシュとして
 * 扱うと、古い説明文が根拠不明のまま画面に残り続ける。
 */
function isStale(
  analyzed: DeficitFactorAnalysisRecord | undefined,
  currentProfit: number,
): boolean {
  if (!analyzed) return true;
  if (analyzed.profitAtAnalysis === null) return true;
  return Math.abs(analyzed.profitAtAnalysis - currentProfit) >= PROFIT_DRIFT_TOLERANCE_YEN;
}
