import type { CleansingDecisionType, CleansingFlagType } from "../rules/cleansingRules";

/**
 * 業務フロー STEP1「データ整形」の判断履歴の永続化インターフェース。
 * 実装(D1)は Infrastructure層に置く。
 */
export interface CleansingDecisionRecord {
  yearMonth: string;
  sourceType: string;
  /** 伝票の自然キー (管理№-行№) */
  rowKey: string;
  vehicleNo: string | null;
  driverName: string | null;
  flagTypes: CleansingFlagType[];
  decision: CleansingDecisionType;
  correctedVehicleNo: string | null;
  note: string | null;
}

export interface CleansingDecisionRepository {
  findByYearMonth(yearMonth: string, sourceType: string): Promise<CleansingDecisionRecord[]>;

  /** 判断済み件数だけを数える (ホームの進捗表示用。全件読まずに済ませる) */
  countByYearMonth(yearMonth: string, sourceType: string): Promise<number>;

  /**
   * 前月以前に同じ伝票キーへ下された最新の判断を引く (翌月の既定値の提案用)。
   * 対象キーが多くなるため、rowKey の一覧を渡して1クエリで取り切る。
   */
  findPreviousDecisions(
    sourceType: string,
    rowKeys: readonly string[],
    beforeYearMonth: string,
  ): Promise<CleansingDecisionRecord[]>;

  upsertMany(records: readonly CleansingDecisionRecord[], decidedBy: string | null): Promise<void>;
}

/** 業務ルールの設定値 (キリン配賦先車番など)。 */
export interface AppSettingRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, updatedBy: string | null): Promise<void>;
}
