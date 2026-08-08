import type { RateSettings } from "../rules/vehiclePlCalculation";
import type { DeficitThresholds } from "../rules/deficitClassification";

/**
 * 車両マスタ (保険・税・リース・配賦単価等、連鎖確定の土台)。
 * 要件定義§2.2「車検/更新イベント時のみマスタ更新→月割自動配賦」に対応する読み取り専用IF。
 */
export interface VehicleMasterRecord {
  vehicleNo: string;
  vehicleType: string;
  depot: string;
  regDate: string | null;
  /** STANDARD_COST_RATES のキー (6.5t/large/semiTrailer/unic/medium/trailer) */
  costCategory: string;
  insCompulsory: number;
  insVoluntary: number;
  taxAuto: number;
  taxWeight: number;
  lease: number;
  installment: number;
  /**
   * トレーラ(被けん引車)が、どのトラクタにけん引されるか。トレーラ行だけが持つ。
   * 値が入っている車両は単独では収支表に出さず、けん引側の行に合算される。
   */
  towedByVehicleNo?: string | null;
}

/**
 * 車両マスタの一括登録・更新の入力。
 * regDate は収支計算に使わないため取込対象外とし、既存値を維持する。
 */
export interface VehicleMasterUpsertInput {
  vehicleNo: string;
  vehicleType: string;
  depot: string;
  costCategory: string;
  insCompulsory: number;
  insVoluntary: number;
  taxAuto: number;
  taxWeight: number;
  lease: number;
  installment: number;
  /** けん引するトラクタの車番 (トレーラ行のみ)。CSVに列が無ければ既存値を維持する。 */
  towedByVehicleNo?: string | null;
}

export interface VehicleMasterRepository {
  findAllActive(): Promise<VehicleMasterRecord[]>;

  /**
   * 車番をキーに一括で登録・更新する (CSV一括取込)。
   * 台数は数十台規模で、毎月まとめて登録し直す運用のため、差分ではなく全件upsertでよい。
   * 新規と更新の内訳を返すのは、取込結果を「新規2件・更新3件」と人が確認できるようにするため。
   */
  upsertMany(records: VehicleMasterUpsertInput[]): Promise<{ inserted: number; updated: number }>;

  /**
   * リース料・割賦支払額を更新する (業務フロー STEP7「変更があれば都度修正する」)。
   * 収支表の値を直接いじらせず、必ず土台の車両マスタを直して再計算させるための入口。
   */
  updateLeaseInstallment(
    vehicleNo: string,
    lease: number,
    installment: number,
  ): Promise<void>;

  /**
   * トレーラ(被けん引車)のけん引先トラクタを設定する。null で解除。
   *
   * この対応表は元データのどのCSVにも無く、現行Excelの行ラベル(「129/1113」)だけが
   * 持っている情報なので、人が画面で登録する以外に手段がない。
   */
  updateTowedBy(vehicleNo: string, towedByVehicleNo: string | null): Promise<void>;
}

/** 運転者マスタ (社員コードで車番と紐づく。1:1ではない) */
export interface DriverMasterRecord {
  employeeCode: string;
  driverName: string;
  vehicleNo: string | null;
}

export interface DriverMasterUpsertInput {
  employeeCode: string;
  driverName: string;
  vehicleNo: string | null;
}

export interface DriverMasterRepository {
  findAll(): Promise<DriverMasterRecord[]>;

  /**
   * 社員コードをキーに一括で登録・更新する (CSV一括取込)。
   * 車両マスタと同じく、毎月まとめて登録し直す運用のため全件upsertでよい。
   * 新規と更新の内訳を返すのは、取込結果を人が確認してから確定できるようにするため。
   */
  upsertMany(records: DriverMasterUpsertInput[]): Promise<{ inserted: number; updated: number }>;
}

/**
 * レート・原価単価マスタ (一般管理費率・割引率・賞与年額・インタンク単価等)。
 * ハードコード禁止(要件定義)のため、収支確定時はここから RateSettings を組み立てる。
 */
export interface RateMasterRepository {
  /** yearMonth 指定のtank_price等を優先し、無ければ全期間共通値・デフォルト値の順でフォールバックする */
  getRates(yearMonth: string): Promise<RateSettings>;

  /**
   * 赤字3分類・損益分岐km単価の閾値を取得する (S9 赤字の理由 / S7 ダッシュボード)。
   * getRates と同じフォールバック順 (月指定→全期間共通→既定値)。
   */
  getDeficitThresholds(yearMonth: string): Promise<DeficitThresholds>;

  /**
   * レート単価を1件だけ読む (キリン協力金の受取額など、RateSettings に含まれない設定値用)。
   * getRates と同じフォールバック順 (月指定→全期間共通→引数の既定値)。
   */
  getRate(key: string, yearMonth: string, fallback: number): Promise<number>;

  /**
   * レート単価を1件 upsert する (手入力画面「インタンク単価」用, §2.2)。
   * key は D1RateMasterRepository の RATE_KEYS 値 (例: "tank_price")。
   * yearMonth を渡すとその月限定の値、null なら全期間共通値として保存する。
   */
  setRate(key: string, yearMonth: string | null, value: number, updatedBy: string | null): Promise<void>;
}
