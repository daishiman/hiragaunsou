/**
 * 業務フロー STEP3(燃料費) / STEP5(修繕費・タイヤ) / STEP6(高速料金) の人手入力の永続化。
 *
 * 請求書は月内の別々のタイミングで届くため、入力は1回で終わらない。
 * 途中まで入力して保存 → 後日続きを入力 → その場で修正、を成立させるためのインターフェース。
 */

export interface ManualInputRecord {
  vehicleNo: string;
  /** STEP3 燃料費 */
  fuelInQty: number;
  fuelOut: number;
  fuelOutQty: number;
  adblue: number;
  /** STEP5 経費 */
  repairActual: number;
  /** タイヤ実費。null なら km×単価の標準原価にフォールバックする */
  tireActual: number | null;
  equip: number;
  mainte: number;
  /** STEP6 高速料金。null なら売上モニタリスト由来の通行料/組合割引率で近似する */
  tollActual: number | null;
  tollDiscountActual: number | null;
  /** STEP2 キリン配賦を含む「その他」諸経費 */
  miscOther: number;
}

export interface ManualInputRepository {
  findByYearMonth(yearMonth: string): Promise<ManualInputRecord[]>;
  /** year_month + vehicle_no で upsert する (部分入力の保存を何度でも受ける) */
  upsertMany(
    yearMonth: string,
    records: readonly ManualInputRecord[],
    updatedBy: string | null,
  ): Promise<void>;
}
