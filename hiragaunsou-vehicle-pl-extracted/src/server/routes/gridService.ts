import { VEHICLE_PL_FIELDS, type VehiclePlField } from "../calc/fields";
import type { AnomalyFlag } from "../calc/anomaly";

/**
 * F1 月次収支グリッド用のレスポンス整形 (S2画面)。
 * DBアクセス(drizzle/D1)とは分離し、単体テスト可能な純粋関数として実装する。
 */
export interface GridRow {
  vehicleNo: string;
  values: Record<VehiclePlField, number | string | null>;
  /** 異常値セルのハイライト対象フィールド一覧 */
  highlightedFields: string[];
}

export interface GridResponse {
  yearMonth: string;
  fields: readonly VehiclePlField[];
  rows: GridRow[];
  isEmpty: boolean;
}

export function buildGridResponse(
  yearMonth: string,
  plRows: Array<Record<string, unknown> & { vehicleNo: string }>,
  anomalyFlags: AnomalyFlag[],
): GridResponse {
  const flagsByVehicle = new Map<string, Set<string>>();
  for (const flag of anomalyFlags) {
    const set = flagsByVehicle.get(flag.vehicleNo) ?? new Set<string>();
    set.add(flag.field);
    flagsByVehicle.set(flag.vehicleNo, set);
  }

  const rows: GridRow[] = plRows.map((row) => {
    const values = {} as Record<VehiclePlField, number | string | null>;
    for (const field of VEHICLE_PL_FIELDS) {
      values[field] = (row[field] as number | string | null) ?? null;
    }
    return {
      vehicleNo: row.vehicleNo,
      values,
      highlightedFields: Array.from(flagsByVehicle.get(row.vehicleNo) ?? []),
    };
  });

  return {
    yearMonth,
    fields: VEHICLE_PL_FIELDS,
    rows,
    isEmpty: rows.length === 0,
  };
}
