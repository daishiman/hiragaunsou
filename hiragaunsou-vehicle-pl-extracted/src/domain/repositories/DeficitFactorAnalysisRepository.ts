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
  updatedAt: number;
}

export interface DeficitFactorAnalysisUpsertInput {
  vehicleNo: string;
  yearMonth: string;
  summary: string;
  factors: DeficitFactorItem[];
  model: string;
}

export interface DeficitFactorAnalysisRepository {
  /** 指定月の分析済み結果を全件返す (/deficit 一覧のバッジ表示用) */
  findByYearMonth(yearMonth: string): Promise<DeficitFactorAnalysisRecord[]>;
  /** 指定車両×月の分析結果を1件返す (/vehicle/[vehicleNo] 詳細表示用) */
  findOne(vehicleNo: string, yearMonth: string): Promise<DeficitFactorAnalysisRecord | null>;
  /** 常に丸ごと置き換え(既存レコードの部分更新はしない) */
  upsertMany(inputs: DeficitFactorAnalysisUpsertInput[], updatedBy: string | null): Promise<void>;
}
