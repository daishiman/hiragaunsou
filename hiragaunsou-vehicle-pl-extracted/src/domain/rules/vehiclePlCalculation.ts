/**
 * 車両別収支表の計算ロジック (docs/manifest.md 項目説明シート準拠)。
 * 設定可能なレート類 (一般管理費率・組合割引率・賞与年額等) は引数の RateSettings として渡し、
 * ハードコードしない (要件定義 2.2「率マスタから自動」に対応)。
 *
 * 値の正は rate_master であり、下の DEFAULT_RATE_SETTINGS ではない。
 * 既定値はマスタに行が無いときの保険であって、業務上の決定値ではない。
 *
 * Domain層: フレームワーク非依存。D1・fetch等の外部依存を import しない。
 */

export interface RateSettings {
  /** 高速組合割引率。デフォルト 0.356 */
  tollDiscountRate: number;
  /**
   * 一般管理費率。直近3期の一般管理費÷売上の平均として期ごとに改定される。
   * 現行運用値は 0.1748 (rate_master にシード済み。migrations/0015 に根拠)。
   */
  adminFeeRate: number;
  /** 賞与年額(円)。デフォルト 400000 円。月額は /12 */
  bonusAnnual: number;
  /** インタンク軽油単価(円/ℓ)。月ごとに変動するため年月ごとに設定する値 */
  tankPricePerLiter: number;
}

/**
 * rate_master に行が無いときだけ使われる保険値。ここを業務上の正だと思って書き換えないこと。
 *
 * adminFeeRate の 0.169 は現行Excelの「項目説明」シートに残っていた旧記述の値で、
 * 実際の運用は 2026年8月時点で 0.1748。「3期平均」という算出方法が同じまま、
 * 適用する期が進んで結果の率が変わったもの。値を変えたいときはここではなく
 * rate_master を更新する (migrations/0015 に実測根拠と経緯)。
 */
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
  /**
   * その車両に紐づく運転者の人数。賞与は運転者1人あたりの月額なので、
   * 2人乗務の車両は2人分になる (現行Excelも2人乗務車は月5万円で計上している)。
   * 省略時は1人として扱う (運転者マスタ未整備の車両で賞与が消えないようにする)。
   */
  driverCount?: number | null;
  /**
   * 賞与の月額そのもの。null/undefined のときだけ (bonusAnnual/12)×driverCount で計算する。
   *
   * 現行Excelには年額を12で割り切れない月に1円単位で丸めた行がある(車番7219: 25,001 → 25,000)。
   * 賞与を「計算結果」としてしか持たないと、この1円が毎月人手で直され続けることになる。
   * ここは計算の入口なので、上書きしても laborTotal 以下は必ず作り直される。
   */
  bonusMonthly?: number | null;
  /**
   * この車両がけん引するトレーラの車番。mergeTowedVehicles が合算のあとに載せる。
   * 計算には使わないが、収支表の車番ラベルまで運ぶ必要があるので入力に持たせる。
   */
  towedVehicleNos?: readonly string[];
}

export interface VehiclePlCalculated {
  no: string;
  /**
   * この行が吸収したトレーラ(被けん引車)の車番。計算には一切使わず、収支表の車番ラベルを
   * 「129/1113」と組み立てるためだけに運ぶ (合算は mergeTowedVehicles が入口で済ませている)。
   */
  towedVehicleNos?: readonly string[];
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
  /*
    【業務側に未確認の前提】docs/product/業務確認事項.md 質問1
    インタンク給油量には外部給油分が「含まれない」前提で足している。
    もし含まれるなら、ここで外部給油量が二重に乗り、燃費(nempi)が実際より悪く出る。
    なお、デジタコの総給油量(vehicleOperationParser.totalFuelQtyLiter)はこの計算に使っていない。
  */
  const fuelQty = round2(input.fuelInQty + input.fuelOutQty);
  const nempi = fuelQty > 0 ? round2(input.km / fuelQty) : 0;
  const fuelTotal = round2(fuelIn + input.fuelOut + input.adblue);

  const repairStandard = round2(input.km * input.standardCostRate.repairPerKm);
  // STEP5: タイヤ請求書からの実費があればそれを正とし、無ければ km×単価の標準原価を使う。
  const tire = round2(input.tireActual ?? input.km * input.standardCostRate.tirePerKm);
  /*
    【業務側に未確認の前提】docs/product/業務確認事項.md 質問2
    修繕費の空欄は「その月は修繕が無かった(0円)」として扱う。入れ忘れとは区別していない。
    区別できるのは手入力画面まで(確定前に未入力の台数を出している)で、
    ここから先は0円と入れ忘れが同じ数字になる。
  */
  const repairTotal = round2(
    input.repairActual + tire + input.equip + input.mainte,
  );

  const bonus = round2(input.bonusMonthly ?? (rates.bonusAnnual / 12) * (input.driverCount ?? 1));
  const laborTotal = round2(input.salary + bonus + input.welfare);

  const insTotal = round2(input.insCompulsory + input.insVoluntary);
  const taxTotal = round2(input.taxAuto + input.taxWeight);
  /*
    【業務側に未確認の前提】docs/product/業務確認事項.md 質問3
    その他諸経費は、旧Excel(月次収支表)から取り込んだ値を毎月持ち回すだけで、
    このアプリに入力欄を作っていない。「人が毎月入れる数字」なら入力欄が要る。
  */
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
    towedVehicleNos: input.towedVehicleNos,
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
