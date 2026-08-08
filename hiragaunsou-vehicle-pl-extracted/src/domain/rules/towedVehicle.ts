import type { VehiclePlInput } from "./vehiclePlCalculation";

/**
 * トラクタ(けん引車)とトレーラ(被けん引車)の統合。
 *
 * トレーラは車検証上は別車両なので保険料・自動車税・重量税・リース料が単独で付くが、
 * 運転者も運賃も付かない。そのままだと収支表に「売上ゼロ・費用だけの赤字行」が並び、
 * けん引しているトラクタは自分の稼ぎに見合わない黒字に見える。
 * 現行Excelの最終成果物が両者を1行にまとめているのはこのため。
 *
 * 合算は calculateVehiclePl の「手前」でやる。ここで下流(損益・経費計・一般管理費)まで
 * 足し合わせると、一般管理費が合算前の運送収入に対して計算された値の和になってしまい、
 * 「一般管理費 = 運送収入 × 率」が成り立たない行が生まれる。
 * 入口だけ合わせて計算し直せば、実データ(車番2+1100)の 12,868.776 円差とも一致する。
 */

/** 両方 null なら null のまま (「未入力だから標準原価にフォールバックする」の意味を潰さない)。 */
function addNullable(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * トラクタの入力に、そのトラクタがけん引するトレーラの入力を足し込む。
 *
 * 車番・車種・所属・運転者・標準原価単価はトラクタのものを残す。トレーラは自走しないので
 * 走行距離に応じた単価表はトラクタ側の一つだけが正しい。
 */
export function mergeTowedVehicles(
  tractor: VehiclePlInput,
  trailers: readonly VehiclePlInput[],
): VehiclePlInput {
  if (trailers.length === 0) return tractor;
  const merged = trailers.reduce<VehiclePlInput>(
    (acc, t) => ({
      ...acc,
      trips: acc.trips + t.trips,
      slips: acc.slips + t.slips,
      hours: acc.hours + t.hours,
      km: acc.km + t.km,
      fare: acc.fare + t.fare,
      fee: acc.fee + t.fee,
      toll: acc.toll + t.toll,
      fuelInQty: acc.fuelInQty + t.fuelInQty,
      fuelOutQty: acc.fuelOutQty + t.fuelOutQty,
      fuelOut: acc.fuelOut + t.fuelOut,
      adblue: acc.adblue + t.adblue,
      repairActual: acc.repairActual + t.repairActual,
      equip: acc.equip + t.equip,
      mainte: acc.mainte + t.mainte,
      salary: acc.salary + t.salary,
      welfare: acc.welfare + t.welfare,
      // 保険・税・リース・割賦はトレーラ単独で発生する。ここが統合の主目的。
      insCompulsory: acc.insCompulsory + t.insCompulsory,
      insVoluntary: acc.insVoluntary + t.insVoluntary,
      taxAuto: acc.taxAuto + t.taxAuto,
      taxWeight: acc.taxWeight + t.taxWeight,
      lease: acc.lease + t.lease,
      installment: acc.installment + t.installment,
      miscOther: acc.miscOther + t.miscOther,
      tireActual: addNullable(acc.tireActual, t.tireActual),
      tollActual: addNullable(acc.tollActual, t.tollActual),
      tollDiscountActual: addNullable(acc.tollDiscountActual, t.tollDiscountActual),
      // トレーラに運転者は紐づかないので実際は 0 だが、足しておけば
      // 誤って運転者マスタでトレーラに人を割り当てた場合も賞与が消えずに気づける。
      driverCount: addNullable(acc.driverCount, t.driverCount),
      bonusMonthly: addNullable(acc.bonusMonthly, t.bonusMonthly),
    }),
    tractor,
  );
  return { ...merged, towedVehicleNos: trailers.map((t) => t.no) };
}

/**
 * 収支表に出す車番のラベル。現行Excelは「129　　1113」「385/100」と区切りが揃っていないので、
 * 読む側が迷わないよう "/" に統一する。
 * データ上の車番はトラクタのままなので、これは表示だけのためのもの。
 */
export function formatVehicleNoLabel(
  vehicleNo: string,
  towedVehicleNos: readonly string[] | string,
): string {
  const towed = (
    typeof towedVehicleNos === "string"
      ? towedVehicleNos.split(",")
      : [...towedVehicleNos]
  )
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return towed.length === 0 ? vehicleNo : [vehicleNo, ...towed].join("/");
}

/**
 * 車種名がトレーラ(被けん引車)を指すか。
 *
 * 判定を車両マスタのパーサ側だけに置くと、収支表の所見(けん引先が未登録のトレーラを
 * 知らせる指摘)が infrastructure 層を参照することになる。業務知識なのでここに置き、
 * パーサはこの規則を使う。
 */
export const TRAILER_VEHICLE_TYPE_PATTERN = /被けん引|被牽引|台車/;

export function isTrailerVehicleType(vehicleType: string): boolean {
  return TRAILER_VEHICLE_TYPE_PATTERN.test(vehicleType);
}
