import { VEHICLE_PL_FIELDS, type VehiclePlField } from "../../domain/entities/VehiclePl";
import type { AnomalyFlag } from "../../domain/rules/anomalyDetection";
import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { ReviewFlagRepository } from "../../domain/repositories/VehiclePlRepository";

/**
 * F1 月次収支グリッド ユースケース (S2画面)。
 * UseCase層: リポジトリインターフェース越しにのみ外部接続する。DBの具体実装は知らない。
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

export class GetMonthlyGridUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly reviewFlagRepo: ReviewFlagRepository,
  ) {}

  async execute(yearMonth: string): Promise<GridResponse> {
    const plRows = await this.vehiclePlRepo.findByYearMonth(yearMonth);
    const openFlags = await this.reviewFlagRepo.findOpenByYearMonth(yearMonth);
    const anomalyFlags: AnomalyFlag[] = openFlags
      .filter((f) => f.vehicleNo && f.field)
      .map((f) => ({
        vehicleNo: f.vehicleNo as string,
        field: f.field as string,
        type: f.type as AnomalyFlag["type"],
        message: f.message,
        monthlyReference: null,
        value: null,
      }));
    return buildGridResponse(
      yearMonth,
      plRows.map((r) => ({ ...r, vehicleNo: r.no as string })),
      anomalyFlags,
    );
  }
}
