/**
 * 赤字車両(車番×年月)のAI要因分析結果の永続化インターフェース。
 * 月単位バッチでAIを呼び出し、結果をここにキャッシュすることで同月の再訪時の再呼び出しを避ける。
 */

/** 収支表の科目キー("sales"は売上そのものが要因になるケース用) */
export type DeficitFactorCategory =
  | "sales"
  | "tollNet"
  | "fuelTotal"
  | "repairTotal"
  | "laborTotal"
  | "insTotal"
  | "taxTotal"
  | "transportTotal"
  | "adminTotal";

export interface DeficitFactorItem {
  category: DeficitFactorCategory;
  /** その科目が「高すぎる(費用)/低すぎる(売上)」ことが赤字要因になっているか */
  direction: "high" | "low";
  /** 目安金額(円)。標準原価・他車平均等との差分をAIに算出させた値 */
  amountYen: number;
  explanation: string;
}

export interface DeficitFactorAnalysisRecord {
  vehicleNo: string;
  yearMonth: string;
  summary: string;
  factors: DeficitFactorItem[];
  model: string;
  /**
   * 分析した時点の損益(円)。分析文が前提にしていた金額のスナップショット。
   *
   * これが無いと「車番が既にあるか」しかキャッシュの鍵にできず、率マスタや手入力が
   * 変わって損益が動いても古い説明文が残り続ける (一般管理費率の改定で実際に起きた)。
   * null はこの列が無かった頃のレコード。陳腐化を判定できないので再分析対象として扱う。
   */
  profitAtAnalysis: number | null;
  updatedAt: number;
}

export interface DeficitFactorAnalysisUpsertInput {
  vehicleNo: string;
  yearMonth: string;
  summary: string;
  factors: DeficitFactorItem[];
  model: string;
  /** 分析対象にしたときの損益(円)。次回この値と現在値を比べて陳腐化を判定する */
  profitAtAnalysis: number;
}

export interface DeficitFactorAnalysisRepository {
  /** 指定月の分析済み結果を全件返す (/deficit 一覧のバッジ表示用) */
  findByYearMonth(yearMonth: string): Promise<DeficitFactorAnalysisRecord[]>;
  /** 指定車両×月の分析結果を1件返す (/vehicle/[vehicleNo] 詳細表示用) */
  findOne(vehicleNo: string, yearMonth: string): Promise<DeficitFactorAnalysisRecord | null>;
  /** 常に丸ごと置き換え(既存レコードの部分更新はしない) */
  upsertMany(inputs: DeficitFactorAnalysisUpsertInput[], updatedBy: string | null): Promise<void>;
}
