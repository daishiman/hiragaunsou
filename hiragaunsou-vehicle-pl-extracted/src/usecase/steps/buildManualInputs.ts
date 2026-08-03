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
  equip?: number | string | null;
  mainte?: number | string | null;
  miscOther?: number | string | null;
};

function toNonNegativeNumber(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (typeof n !== "number" || Number.isNaN(n) || !Number.isFinite(n)) return 0;
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
      equip: toNonNegativeNumber(r.equip),
      mainte: toNonNegativeNumber(r.mainte),
      miscOther: toNonNegativeNumber(r.miscOther),
    }));
}
