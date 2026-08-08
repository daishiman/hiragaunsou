/**
 * 車両別収支表 51列スキーマ (A〜AY列, 5月収支表シート準拠)
 * キー名は mock/data.js の "fields" 配列と揃えている (フロント互換のため)。
 * 参照: docs/requirement.md セクション「収支表51列スキーマ」
 *
 * このファイルはフレームワーク非依存 (Domain層)。D1・fetch等の外部依存を import しない。
 */
export const VEHICLE_PL_FIELDS = [
  "no", // 車番
  "type", // 車種名
  "depot", // 所属
  "reg", // 初年度登録
  "code", // 社員コード
  "driver", // 運転者名
  "trips", // 運行回数
  "slips", // 伝票件数
  "hours", // 稼働時間(h)
  "km", // 稼働Km
  "fare", // 運賃
  "fee", // 附帯料金
  "sales", // 運送収入 = fare + fee
  "toll", // 道路使用料
  "tollDisc", // 高速割引料 = toll * 0.356
  "tollNet", // 運行費計 = toll - tollDisc
  "fuelIn", // 軽油代インタンク
  "fuelInQty", // インタンク給油量
  "fuelOut", // 軽油代外部
  "fuelOutQty", // 外部給油量
  "fuelQty", // 給油量合計 = fuelInQty + fuelOutQty
  "nempi", // 燃費 = km / fuelQty
  "adblue", // 外部アドブルー
  "fuelTotal", // 燃料費計 = fuelIn + fuelOut + adblue
  "repair", // 修理費(実費)
  "tire", // タイヤ費
  "equip", // 備品費
  "mainte", // メンテ(委託)
  "repairTotal", // 修繕費計 = repair + tire + equip + mainte
  "salary", // 給与
  "bonus", // 賞与 = 400000/12 固定
  "welfare", // 福利厚生費 = 社保合計
  "laborTotal", // 人件費計 = salary + bonus + welfare
  "insCompulsory", // 自賠責保険
  "insVoluntary", // 任意保険
  "insTotal", // 保険料計
  "taxAuto", // 自動車税
  "taxWeight", // 自動車重量税
  "taxTotal", // 賦課税計
  "miscOther", // その他諸経費
  "miscTotal", // 諸経費計 = miscOther
  "lease", // 車両リース費
  "installment", // 車両割賦支払費
  "transportTotal", // 運送費計 = lease + installment
  "adminFee", // 一般管理費 = sales * adminFeeRate
  "adminTotal", // 管理費計 = adminFee
  "fixed", // 固定費 = insTotal + taxTotal + transportTotal
  "variable", // 変動費 = fuelTotal + repairTotal + tollNet + laborTotal + miscTotal + adminTotal
  "expense", // 経費計 = fixed + variable
  "profit", // 損益 = sales - expense
  "margin", // 利益率 = profit / sales
] as const;

export type VehiclePlField = (typeof VEHICLE_PL_FIELDS)[number];

export type VehiclePlRow = Record<VehiclePlField, number | string | null>;

/** 修繕費 標準原価単価表 (円/km)。原価計算シート準拠 */
export const STANDARD_COST_RATES: Record<
  string,
  { repairPerKm: number; tirePerKm: number }
> = {
  "6.5t": { repairPerKm: 10.7, tirePerKm: 2.1 },
  large: { repairPerKm: 10.7, tirePerKm: 3.9 },
  semiTrailer: { repairPerKm: 7.6, tirePerKm: 3.3 },
  unic: { repairPerKm: 3.8, tirePerKm: 1.7 },
  medium: { repairPerKm: 3.8, tirePerKm: 1.7 },
  /**
   * トレーラ(被けん引車)。自走しないので走行距離が付かず、修理・タイヤの標準原価も
   * トラクタ側の走行距離で計上される。ここを medium にフォールバックさせると、
   * 統合時にトレーラ分の km が 0 でも単価表だけが二重に効く余地を残すため 0 で固定する。
   */
  trailer: { repairPerKm: 0, tirePerKm: 0 },
};

/** 傭車として自動除外する車番 (機械的判定してよいと要件定義で明記) */
export const CHARTERED_VEHICLE_NO = "88888";
