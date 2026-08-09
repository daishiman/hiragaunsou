import type {
  DriverMasterRecord,
  DriverMasterRepository,
  VehicleMasterRecord,
  VehicleMasterRepository,
} from "../../domain/repositories/MasterRepository";
import {
  detectImportDiffs,
  detectNearMatches,
  excludeAcked,
  sortImportDiffs,
  type AbsorbedDiff,
  type ComparableRecord,
  type ImportDiff,
  type ImportDiffTargetKind,
} from "../../domain/rules/importDiffDetection";

/**
 * 取込のたびに「前回と異なります」を出すための組み立て。
 *
 * 比べる相手は “前回の取込のあとの状態” で、それは上書きされて残らない。
 * だから比較用の写しを種類ごとに1件だけ持ち、毎回それと突き合わせてから写しを更新する。
 */
export interface ImportCompareSnapshotRepository {
  find(targetKind: ImportDiffTargetKind): Promise<ComparableRecord[] | null>;
  save(targetKind: ImportDiffTargetKind, records: readonly ComparableRecord[]): Promise<void>;
}

export interface ImportDiffAckRepository {
  listFingerprints(): Promise<string[]>;
  ack(input: {
    fingerprint: string;
    targetKind: string;
    targetLabel: string;
    summary: string;
    actor: { id: string | null; name: string };
  }): Promise<void>;
  unack(fingerprint: string): Promise<void>;
}

export interface ImportDiffAbsorbedRepository {
  record(items: readonly AbsorbedDiff[]): Promise<void>;
  list(limit: number): Promise<(AbsorbedDiff & { absorbedAt: number })[]>;
}

/** 車両マスタ1台を、比較できる形にほどく */
export function vehicleToComparable(record: VehicleMasterRecord): ComparableRecord {
  return {
    key: record.vehicleNo,
    label: `車番 ${record.vehicleNo}`,
    fields: [
      { field: "vehicleType", fieldLabel: "車種", value: record.vehicleType, kind: "text" },
      { field: "depot", fieldLabel: "車庫", value: record.depot, kind: "text" },
      { field: "costCategory", fieldLabel: "原価の区分", value: record.costCategory, kind: "text" },
      { field: "insCompulsory", fieldLabel: "自賠責保険", value: String(record.insCompulsory), kind: "amount" },
      { field: "insVoluntary", fieldLabel: "任意保険", value: String(record.insVoluntary), kind: "amount" },
      { field: "taxAuto", fieldLabel: "自動車税", value: String(record.taxAuto), kind: "amount" },
      { field: "taxWeight", fieldLabel: "重量税", value: String(record.taxWeight), kind: "amount" },
      { field: "lease", fieldLabel: "リース料", value: String(record.lease), kind: "amount" },
      { field: "installment", fieldLabel: "割賦の支払", value: String(record.installment), kind: "amount" },
      {
        field: "towedByVehicleNo",
        fieldLabel: "けん引するトラクタ",
        value: record.towedByVehicleNo ?? "",
        kind: "id",
      },
    ],
  };
}

/** 運転者マスタ1名を、比較できる形にほどく */
export function driverToComparable(record: DriverMasterRecord): ComparableRecord {
  return {
    key: record.employeeCode,
    label: record.driverName || `社員コード ${record.employeeCode}`,
    fields: [
      { field: "driverName", fieldLabel: "氏名", value: record.driverName, kind: "name" },
      { field: "vehicleNo", fieldLabel: "乗っている車", value: record.vehicleNo ?? "", kind: "id" },
    ],
  };
}

export interface ImportDiffAlert {
  diffs: ImportDiff[];
  /** 強く出すものの件数。画面のバッジに使う */
  criticalCount: number;
  /** 書き方違いとして自動で吸収した件数 */
  absorbedCount: number;
}

/**
 * いまのマスタと「前回の写し」を突き合わせて、出すべきアラートを作る。
 *
 * @param persist true のとき、写しの更新と吸収した差分の記録を行う (取込直後の呼び出し)。
 *                false のときは読むだけ (画面の再表示)。
 */
export class DetectImportDiffUseCase {
  constructor(
    private readonly deps: {
      vehicleMasterRepo: VehicleMasterRepository;
      driverMasterRepo: DriverMasterRepository;
      snapshotRepo: ImportCompareSnapshotRepository;
      ackRepo: ImportDiffAckRepository;
      absorbedRepo: ImportDiffAbsorbedRepository;
    },
  ) {}

  async execute(options?: { persist?: boolean }): Promise<ImportDiffAlert> {
    const persist = options?.persist ?? false;

    const [vehicles, drivers, ackedList] = await Promise.all([
      this.deps.vehicleMasterRepo.findAllActive(),
      this.deps.driverMasterRepo.findAll(),
      this.deps.ackRepo.listFingerprints(),
    ]);

    const acked = new Set(ackedList);
    const current: Record<ImportDiffTargetKind, ComparableRecord[]> = {
      vehicle: vehicles.map(vehicleToComparable),
      driver: drivers.map(driverToComparable),
      rate: [],
    };

    const diffs: ImportDiff[] = [];
    const absorbed: AbsorbedDiff[] = [];

    for (const targetKind of ["vehicle", "driver"] as const) {
      const previous = (await this.deps.snapshotRepo.find(targetKind)) ?? [];
      const result = detectImportDiffs({
        previous,
        current: current[targetKind],
        targetKind,
      });
      diffs.push(...result.diffs);
      // 「もしかして同じ?」は運転者名だけが対象。車両は名前を持たない
      if (targetKind === "driver") {
        diffs.push(...detectNearMatches(current[targetKind], targetKind));
      }
      absorbed.push(...result.absorbed);

      if (persist) {
        await this.deps.snapshotRepo.save(targetKind, current[targetKind]);
      }
    }

    if (persist && absorbed.length > 0) {
      await this.deps.absorbedRepo.record(absorbed);
    }

    const visible = sortImportDiffs(excludeAcked(diffs, acked));
    return {
      diffs: visible,
      criticalCount: visible.filter((d) => d.severity === "critical").length,
      absorbedCount: absorbed.length,
    };
  }
}
