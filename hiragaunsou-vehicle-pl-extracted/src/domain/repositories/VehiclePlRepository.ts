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
}

export interface ImportBatchRepository {
  createBatch(input: {
    id: string;
    sourceType: string;
    yearMonth: string;
    fileName: string;
    importedBy: string | null;
    rowCount: number;
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
    importedAt: number;
    status: string;
  } | null>;
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
}
