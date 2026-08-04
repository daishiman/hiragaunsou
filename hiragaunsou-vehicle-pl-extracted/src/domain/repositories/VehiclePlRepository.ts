import type { VehiclePlCalculated } from "../rules/vehiclePlCalculation";

/**
 * 計算済み車両別収支表(vehicle_pl)の永続化インターフェース。
 * 実装(D1)は Infrastructure層に置く。UseCase層はこのインターフェース越しにのみアクセスする。
 */
export interface VehiclePlRepository {
  /** year_month + vehicle_no で一意に upsert する */
  upsertMany(yearMonth: string, rows: VehiclePlCalculated[]): Promise<void>;
  findByYearMonth(yearMonth: string): Promise<VehiclePlCalculated[]>;
  findByVehicleNo(vehicleNo: string): Promise<VehiclePlCalculated[]>;
  /**
   * 複数月分をまとめて取得する (S8 年間集計・S7 ダッシュボード・異常値チェックの12ヶ月比較用)。
   * 月ごとに12回クエリを投げるとD1のサブリクエスト上限に近づくため、1クエリで取り切る。
   */
  findByYearMonths(yearMonths: readonly string[]): Promise<Map<string, VehiclePlCalculated[]>>;
  /** 登録済み車両件数 (サイドバーのバッジ用。全列を引かずに件数だけ取る) */
  countByYearMonth(yearMonth: string): Promise<number>;

  /**
   * 月次収支表の確定状態 (業務フロー STEP8「運送収支表への転記(完成)」の代替)。
   * 全行が確定済みのときだけ confirmed=true とする。
   */
  getConfirmation(yearMonth: string): Promise<{ total: number; confirmed: number }>;

  /** 確定/確定解除を月単位で切り替える */
  setConfirmed(yearMonth: string, confirmed: boolean): Promise<void>;
}

/** 年間集計の参照値 (前年度実績 / 現行Excel年間集計シートの転記値)。 */
export type AnnualReferenceKind = "prev_year_actual" | "excel_annual_sheet";

export interface AnnualReferenceRecord {
  kind: AnnualReferenceKind;
  yearMonth: string;
  sales: number;
  expense: number;
  note: string | null;
}

export interface AnnualReferenceRepository {
  findByKind(kind: AnnualReferenceKind, yearMonths: readonly string[]): Promise<AnnualReferenceRecord[]>;
  upsertMany(records: readonly AnnualReferenceRecord[], updatedBy: string | null): Promise<void>;
}

export interface ImportBatchRepository {
  createBatch(input: {
    id: string;
    sourceType: string;
    yearMonth: string;
    fileName: string;
    importedBy: string | null;
    rowCount: number;
    /** 取込時に機械的に除外した行数 (傭車)。省略時は0 */
    excludedRowCount?: number;
  }): Promise<void>;

  saveRawIngestion(
    batchId: string,
    sourceType: string,
    yearMonth: string,
    rows: { rowIndex: number; naturalKey: string | null; raw: unknown; flags: string[] }[],
  ): Promise<void>;

  /** その年月・帳票種別で取り込み済みのバッチを新しい順に返す(取込状況の表示・入れ直し判定用) */
  findBatches(
    yearMonth: string,
    sourceType: string,
  ): Promise<{ id: string; fileName: string; rowCount: number; importedAt: number }[]>;

  /**
   * 取込バッチと、それに紐づく原始データを消す(入れ直し用)。
   * 追記のままだと同じ月を取り込むたびにraw_ingestionが重複して積み上がり、
   * 「どのバッチが正か」が曖昧になるため、入れ直し時は必ず先に消す。
   * @returns 削除した原始データの行数
   */
  deleteBatches(yearMonth: string, sourceType: string, batchIds: string[]): Promise<number>;

  /** 収支確定(締め)時に、取込済みraw_ingestionを年月+ソース種別で読み出す */
  findRawRows(
    yearMonth: string,
    sourceType: string,
  ): Promise<{ naturalKey: string | null; raw: unknown; flags: string[] }[]>;

  /** 手入力画面「給与取込確認」用: 年月+ソース種別の最新取込バッチを1件返す(無ければnull) */
  findLatestBatch(
    yearMonth: string,
    sourceType: string,
  ): Promise<{
    id: string;
    fileName: string;
    rowCount: number;
    excludedRowCount: number;
    importedAt: number;
    status: string;
  } | null>;

  /**
   * STEP1「データ整形」の要確認件数を数える (ホームの進捗判定用)。
   * 生データを全部読むとホームの表示が重くなるため、件数だけをSQLで取る。
   */
  countRawRowsWithFlags(yearMonth: string, sourceType: string): Promise<number>;
}

export interface ReviewFlagRepository {
  createFlags(
    yearMonth: string,
    flags: {
      vehicleNo: string | null;
      field: string | null;
      type: string;
      severity: "info" | "warning" | "critical";
      message: string;
      monthlyReference: number | null;
    }[],
  ): Promise<void>;

  findOpenByYearMonth(yearMonth: string): Promise<
    {
      id: string;
      vehicleNo: string | null;
      field: string | null;
      type: string;
      severity: string;
      message: string;
      status: string;
    }[]
  >;

  resolve(id: string, resolvedBy: string, status: "corrected" | "approved" | "dismissed", note: string | null): Promise<void>;

  /**
   * 判定を取り消して未判定(open)に戻す (異常値チェックのUndo)。
   * 自動処理・省略操作には必ず戻せる経路を残す、という体験設計の原則に対応する。
   */
  reopen(id: string): Promise<void>;
}
