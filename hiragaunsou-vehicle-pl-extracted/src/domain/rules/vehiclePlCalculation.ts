/**
 * 車両別収支表の計算ロジック (docs/manifest.md 項目説明シート準拠)。
 * 設定可能なレート類 (一般管理費率・組合割引率・賞与年額等) は引数の RateSettings として渡し、
 * ハードコードしない (要件定義「一般管理費 = 運送収入 × 16.9%…ハードコード禁止」に対応)。
 *
 * Domain層: フレームワーク非依存。D1・fetch等の外部依存を import しない。
 */

export interface RateSettings {
  /** 高速組合割引率。デフォルト 0.356 */
  tollDiscountRate: number;
  /** 一般管理費率 (3期平均)。デフォルト 0.169 */
  adminFeeRate: number;
  /** 賞与年額(円)。デフォルト 400000 円。月額は /12 */
  bonusAnnual: number;
  /** インタンク軽油単価(円/ℓ)。月ごとに変動するため年月ごとに設定する値 */
  tankPricePerLiter: number;
}

export const DEFAULT_RATE_SETTINGS: RateSettings = {
  tollDiscountRate: 0.356,
  adminFeeRate: 0.169,
  bonusAnnual: 400000,
  tankPricePerLiter: 0,
};

/** 修繕費 標準原価(km×単価)算出用の車種別単価 */
export interface StandardCostRate {
  repairPerKm: number;
  tirePerKm: number;
}

export interface VehiclePlInput {
  no: string;
  type: string;
  depot: string;
  reg: string | null;
  code: string | null;
  driver: string | null;
  trips: number;
  slips: number;
  hours: number;
  km: number;
  fare: number;
  fee: number;
  toll: number;
  fuelInQty: number;
  fuelOutQty: number;
  fuelOut: number;
  adblue: number;
  /** 修理費 実費 */
  repairActual: number;
  equip: number;
  mainte: number;
  /** 給与 (社員コードで別テーブルから紐づけ済みの値をそのまま渡す) */
  salary: number;
  /** 福利厚生費 (社保合計額。給与データ由来) */
  welfare: number;
  insCompulsory: number;
  insVoluntary: number;
  taxAuto: number;
  taxWeight: number;
  miscOther: number;
  lease: number;
  installment: number;
  /** 標準原価単価 (repairStandard/tireStandard を km 連動で計算するため) */
  standardCostRate: StandardCostRate;
  /**
   * タイヤ費 実費 (業務フローSTEP5: 各社請求書から車番・金額を入力)。
   * null/undefined のときだけ km×単価の標準原価にフォールバックする。
   */
  tireActual?: number | null;
  /**
   * 高速通行料 実費 (業務フローSTEP6: 高速協の請求書から入力)。
   * null/undefined のときだけ売上モニタリスト由来の toll を使う。
   */
  tollActual?: number | null;
  /**
   * 高速割引額 実費 (業務フローSTEP6: 請求書に合計が無いため個別割引額を合算した値)。
   * null/undefined のときだけ toll × tollDiscountRate で近似する。
   */
  tollDiscountActual?: number | null;
}

export interface VehiclePlCalculated {
  no: string;
  type: string;
  depot: string;
  reg: string | null;
  code: string | null;
  driver: string | null;
  trips: number;
  slips: number;
  hours: number;
  km: number;
  fare: number;
  fee: number;
  sales: number;
  toll: number;
  tollDisc: number;
  tollNet: number;
  fuelIn: number;
  fuelInQty: number;
  fuelOut: number;
  fuelOutQty: number;
  fuelQty: number;
  nempi: number;
  adblue: number;
  fuelTotal: number;
  /** 修理費 実費 (監査性のため別保持) */
  repair: number;
  /** 修理費 標準原価 (km×単価。実力損益用の参考値。51列には含まれないが別フィールドで保持) */
  repairStandard: number;
  tire: number;
  equip: number;
  mainte: number;
  repairTotal: number;
  salary: number;
  bonus: number;
  welfare: number;
  laborTotal: number;
  insCompulsory: number;
  insVoluntary: number;
  insTotal: number;
  taxAuto: number;
  taxWeight: number;
  taxTotal: number;
  miscOther: number;
  miscTotal: number;
  lease: number;
  installment: number;
  transportTotal: number;
  adminFee: number;
  adminTotal: number;
  fixed: number;
  variable: number;
  expense: number;
  profit: number;
  margin: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 51列収支表の計算式を適用する。
 * 上流(自動流入/連鎖確定)の値が揃っていれば、下流(固定費/変動費/損益/利益率等)は
 * 必ずこの関数から再計算される(手入力させない原則。要件定義2.3参照)。
 */
export function calculateVehiclePl(
  input: VehiclePlInput,
  rates: RateSettings = DEFAULT_RATE_SETTINGS,
): VehiclePlCalculated {
  const sales = input.fare + input.fee;

  // STEP6: 高速協の請求書から入力された実費があればそれを正とする。
  // 無いときだけ売上モニタリスト由来の通行料と組合割引率で近似する。
  const toll = input.tollActual ?? input.toll;
  const tollDisc = round2(input.tollDiscountActual ?? toll * rates.tollDiscountRate);
  const tollNet = round2(toll - tollDisc);

  const fuelIn = round2(input.fuelInQty * rates.tankPricePerLiter);
  const fuelQty = round2(input.fuelInQty + input.fuelOutQty);
  const nempi = fuelQty > 0 ? round2(input.km / fuelQty) : 0;
  const fuelTotal = round2(fuelIn + input.fuelOut + input.adblue);

  const repairStandard = round2(input.km * input.standardCostRate.repairPerKm);
  // STEP5: タイヤ請求書からの実費があればそれを正とし、無ければ km×単価の標準原価を使う。
  const tire = round2(input.tireActual ?? input.km * input.standardCostRate.tirePerKm);
  const repairTotal = round2(
    input.repairActual + tire + input.equip + input.mainte,
  );

  const bonus = round2(rates.bonusAnnual / 12);
  const laborTotal = round2(input.salary + bonus + input.welfare);

  const insTotal = round2(input.insCompulsory + input.insVoluntary);
  const taxTotal = round2(input.taxAuto + input.taxWeight);
  const miscTotal = round2(input.miscOther);
  const transportTotal = round2(input.lease + input.installment);

  const adminFee = round2(sales * rates.adminFeeRate);
  const adminTotal = adminFee;

  const fixed = round2(insTotal + taxTotal + transportTotal);
  const variable = round2(
    fuelTotal + repairTotal + tollNet + laborTotal + miscTotal + adminTotal,
  );
  const expense = round2(fixed + variable);
  const profit = round2(sales - expense);
  const margin = sales !== 0 ? round2(profit / sales) : 0;

  return {
    no: input.no,
    type: input.type,
    depot: input.depot,
    reg: input.reg,
    code: input.code,
    driver: input.driver,
    trips: input.trips,
    slips: input.slips,
    hours: input.hours,
    km: input.km,
    fare: input.fare,
    fee: input.fee,
    sales: round2(sales),
    toll,
    tollDisc,
    tollNet,
    fuelIn,
    fuelInQty: input.fuelInQty,
    fuelOut: input.fuelOut,
    fuelOutQty: input.fuelOutQty,
    fuelQty,
    nempi,
    adblue: input.adblue,
    fuelTotal,
    repair: input.repairActual,
    repairStandard,
    tire,
    equip: input.equip,
    mainte: input.mainte,
    repairTotal,
    salary: input.salary,
    bonus,
    welfare: input.welfare,
    laborTotal,
    insCompulsory: input.insCompulsory,
    insVoluntary: input.insVoluntary,
    insTotal,
    taxAuto: input.taxAuto,
    taxWeight: input.taxWeight,
    taxTotal,
    miscOther: input.miscOther,
    miscTotal,
    lease: input.lease,
    installment: input.installment,
    transportTotal,
    adminFee,
    adminTotal,
    fixed,
    variable,
    expense,
    profit,
    margin,
  };
}
