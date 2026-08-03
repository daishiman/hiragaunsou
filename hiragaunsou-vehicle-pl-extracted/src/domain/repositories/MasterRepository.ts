import type { RateSettings } from "../rules/vehiclePlCalculation";

/**
 * 車両マスタ (保険・税・リース・配賦単価等、連鎖確定の土台)。
 * 要件定義§2.2「車検/更新イベント時のみマスタ更新→月割自動配賦」に対応する読み取り専用IF。
 */
export interface VehicleMasterRecord {
  vehicleNo: string;
  vehicleType: string;
  depot: string;
  regDate: string | null;
  /** STANDARD_COST_RATES のキー (6.5t/large/semiTrailer/unic/medium) */
  costCategory: string;
  insCompulsory: number;
  insVoluntary: number;
  taxAuto: number;
  taxWeight: number;
  lease: number;
  installment: number;
}

export interface VehicleMasterRepository {
  findAllActive(): Promise<VehicleMasterRecord[]>;
}

/** 運転者マスタ (社員コードで車番と紐づく。1:1ではない) */
export interface DriverMasterRecord {
  employeeCode: string;
  driverName: string;
  vehicleNo: string | null;
}

export interface DriverMasterRepository {
  findAll(): Promise<DriverMasterRecord[]>;
}

/**
 * レート・原価単価マスタ (一般管理費率・割引率・賞与年額・インタンク単価等)。
 * ハードコード禁止(要件定義)のため、収支確定時はここから RateSettings を組み立てる。
 */
export interface RateMasterRepository {
  /** yearMonth 指定のtank_price等を優先し、無ければ全期間共通値・デフォルト値の順でフォールバックする */
  getRates(yearMonth: string): Promise<RateSettings>;

  /**
   * レート単価を1件 upsert する (手入力画面「インタンク単価」用, §2.2)。
   * key は D1RateMasterRepository の RATE_KEYS 値 (例: "tank_price")。
   * yearMonth を渡すとその月限定の値、null なら全期間共通値として保存する。
   */
  setRate(key: string, yearMonth: string | null, value: number, updatedBy: string | null): Promise<void>;
}
