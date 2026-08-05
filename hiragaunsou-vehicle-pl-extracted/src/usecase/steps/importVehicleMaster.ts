import type {
  VehicleMasterRepository,
  VehicleMasterUpsertInput,
} from "../../domain/repositories/MasterRepository";
import type { AuditLogRepository } from "../../domain/repositories/AuditLogRepository";

export const IMPORT_VEHICLE_MASTER_ACTION = "import_vehicle_master";

export interface ConfirmImportVehicleMasterInput {
  actorId: string;
  actorName: string;
  records: VehicleMasterUpsertInput[];
}

export interface ConfirmImportVehicleMasterResult {
  inserted: number;
  updated: number;
}

/**
 * 車両マスタCSVの取込確定 (/admin/vehicle-master 画面)。
 *
 * 保険・税・リース料は毎月の収支計算の土台であり、ここが変わると過去分も含めた
 * 全車両の原価が動く。誰がいつどの車両を書き換えたかを追えるよう、確定時に必ず
 * 監査ログを残す(取込データ管理の削除ログと同じ扱い)。
 */
export class ConfirmImportVehicleMasterUseCase {
  constructor(
    private readonly vehicleMasterRepo: VehicleMasterRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: ConfirmImportVehicleMasterInput): Promise<ConfirmImportVehicleMasterResult> {
    if (input.records.length === 0) {
      throw new Error("取り込める車両が1件もありません(CSVの内容を確認してください)");
    }

    const result = await this.vehicleMasterRepo.upsertMany(input.records);

    const vehicleNos = input.records.map((r) => r.vehicleNo);
    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: IMPORT_VEHICLE_MASTER_ACTION,
      summary: `車両マスタ ${input.records.length}件を取込(新規${result.inserted}件・更新${result.updated}件)`,
      detail: { ...result, total: input.records.length, vehicleNos },
    });

    return result;
  }
}
