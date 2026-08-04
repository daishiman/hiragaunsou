import type { ManualVehicleInput } from "./finalizeMonthlyPl";

/**
 * 手入力フォーム(/manual-entry)の生入力(文字列 or 数値 or undefined)を
 * FinalizeMonthlyPlUseCase が要求する ManualVehicleInput[] に正規化する。
 *
 * ルール:
 * - 未入力/NaN/負値は 0 として扱う(空欄のまま渡さない。ただし「入力しない」を許容するため例外は投げない)。
 * - vehicleNo が空文字のレコードは無視する。
 *
 * Domain層の計算式(calculateVehiclePl)には一切触れない。ここは純粋な入力整形のみ。
 */
export type RawManualVehicleInput = {
  vehicleNo: string;
  fuelInQty?: number | string | null;
  fuelOut?: number | string | null;
  fuelOutQty?: number | string | null;
  adblue?: number | string | null;
  repairActual?: number | string | null;
  /** タイヤ実費。未入力なら null のまま渡して標準原価にフォールバックさせる */
  tireActual?: number | string | null;
  equip?: number | string | null;
  mainte?: number | string | null;
  /** 高速料金 実費 (STEP6)。未入力なら null のまま渡して従来の近似計算にフォールバックさせる */
  tollActual?: number | string | null;
  tollDiscountActual?: number | string | null;
  miscOther?: number | string | null;
};

function toNonNegativeNumber(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (typeof n !== "number" || Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}

/**
 * 「未入力」と「0円と入力した」を区別する必要がある項目用。
 * 空文字・null・undefined・数値化できない値は null(未入力)、それ以外は0以上の数値にする。
 * 未入力を0に潰すとフォールバック(標準原価/近似計算)が効かなくなるため、ここは0埋めしない。
 */
function toOptionalNonNegativeNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  return n < 0 ? 0 : n;
}

export function buildManualInputs(raw: RawManualVehicleInput[]): ManualVehicleInput[] {
  return raw
    .filter((r) => r.vehicleNo && r.vehicleNo.trim().length > 0)
    .map((r) => ({
      vehicleNo: r.vehicleNo.trim(),
      fuelInQty: toNonNegativeNumber(r.fuelInQty),
      fuelOut: toNonNegativeNumber(r.fuelOut),
      fuelOutQty: toNonNegativeNumber(r.fuelOutQty),
      adblue: toNonNegativeNumber(r.adblue),
      repairActual: toNonNegativeNumber(r.repairActual),
      tireActual: toOptionalNonNegativeNumber(r.tireActual),
      equip: toNonNegativeNumber(r.equip),
      mainte: toNonNegativeNumber(r.mainte),
      tollActual: toOptionalNonNegativeNumber(r.tollActual),
      tollDiscountActual: toOptionalNonNegativeNumber(r.tollDiscountActual),
      miscOther: toNonNegativeNumber(r.miscOther),
    }));
}
