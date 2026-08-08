import type {
  DriverMasterRepository,
  DriverMasterUpsertInput,
  VehicleMasterRepository,
} from "../../domain/repositories/MasterRepository";
import type { AuditLogRepository } from "../../domain/repositories/AuditLogRepository";

export const IMPORT_DRIVER_MASTER_ACTION = "import_driver_master";

export interface ConfirmImportDriverMasterInput {
  actorId: string;
  actorName: string;
  records: DriverMasterUpsertInput[];
}

export interface ConfirmImportDriverMasterResult {
  inserted: number;
  updated: number;
  /** 車両マスタに無い車番を指すため取り込めなかった行。 */
  skipped: { employeeCode: string; driverName: string; vehicleNo: string; reason: string }[];
}

/**
 * 運転者マスタCSVの取込確定 (/admin/driver-master 画面)。
 *
 * 給与集計表は社員コード単位、収支表は車番単位で、両者を結ぶ表はこれしかない。
 * ここが未整備だと給与を正しく取り込んでも人件費が全車両0のままになるため、
 * 車両マスタと同格の土台として扱い、誰がいつ書き換えたかを監査ログに残す。
 */
export class ConfirmImportDriverMasterUseCase {
  constructor(
    private readonly driverMasterRepo: DriverMasterRepository,
    private readonly vehicleMasterRepo: VehicleMasterRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: ConfirmImportDriverMasterInput): Promise<ConfirmImportDriverMasterResult> {
    if (input.records.length === 0) {
      throw new Error("取り込める運転者が1件もありません(CSVの内容を確認してください)");
    }

    // 車番は車両マスタへの外部キーなので、存在しない車番を混ぜるとD1が取込全体を
    // 拒否する。1行の綴り違いで全件やり直しにしないため、該当行だけを外して取り込み、
    // 何を外したかを返す。車番をnullに倒して黙って取り込むと「登録したのに給与が
    // 乗らない」という一番追いにくい壊れ方になるので、それはしない。
    const vehicles = await this.vehicleMasterRepo.findAllActive();
    const knownVehicleNos = new Set(vehicles.map((v) => v.vehicleNo));
    const isKnown = (record: DriverMasterUpsertInput) =>
      record.vehicleNo === null || knownVehicleNos.has(record.vehicleNo);

    const skipped = input.records.filter((r) => !isKnown(r)).map((r) => ({
      employeeCode: r.employeeCode,
      driverName: r.driverName,
      vehicleNo: r.vehicleNo as string,
      reason: `車番「${r.vehicleNo}」が車両マスタにありません。先に車両マスタへ登録してください。`,
    }));
    const records = input.records.filter(isKnown);
    if (records.length === 0) {
      throw new Error(
        "指定された車番がすべて車両マスタにありません。先に車両マスタを登録してください。",
      );
    }

    const result = await this.driverMasterRepo.upsertMany(records);

    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: IMPORT_DRIVER_MASTER_ACTION,
      summary: `運転者マスタ ${records.length}件を取込(新規${result.inserted}件・更新${result.updated}件)`,
      detail: {
        ...result,
        total: input.records.length,
        skippedVehicleNos: skipped.map((v) => v.vehicleNo),
      },
    });

    return { ...result, skipped };
  }
}
