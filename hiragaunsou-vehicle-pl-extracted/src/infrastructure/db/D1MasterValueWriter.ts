import type {
  DriverMasterRepository,
  RateMasterRepository,
  VehicleMasterRepository,
} from "../../domain/repositories/MasterRepository";
import type { MasterEditTargetKind } from "../../domain/rules/masterChangeImpact";
import type { MasterValueWriter } from "../../usecase/steps/applyMasterChange";

/** 率マスタの targetKey は "キー|YYYY-MM"。月を省いたものは全期間共通値 */
export function splitRateKey(targetKey: string): { key: string; yearMonth: string | null } {
  const [key = "", yearMonth = ""] = targetKey.split("|");
  return { key, yearMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth) ? yearMonth : null };
}

/** 直せる車両マスタの項目。ここに無い項目は画面から直せない */
export const EDITABLE_VEHICLE_FIELDS = [
  "vehicleType",
  "depot",
  "costCategory",
  "insCompulsory",
  "insVoluntary",
  "taxAuto",
  "taxWeight",
  "lease",
  "installment",
  "towedByVehicleNo",
] as const;
export type EditableVehicleField = (typeof EDITABLE_VEHICLE_FIELDS)[number];

const NUMERIC_VEHICLE_FIELDS = new Set<string>([
  "insCompulsory",
  "insVoluntary",
  "taxAuto",
  "taxWeight",
  "lease",
  "installment",
]);

/** 直せる運転者マスタの項目 */
export const EDITABLE_DRIVER_FIELDS = ["driverName", "vehicleNo"] as const;

/**
 * 直した値をマスタへ1件ずつ書き戻す。
 *
 * 「1件だけ直す」入口と「元に戻す」入口を同じにするために、種類ごとの書き方をここに集める。
 * 全件のCSV取込と同じ upsert を通すので、取込側の決まり(車番をキーに上書き)から外れない。
 */
export class D1MasterValueWriter implements MasterValueWriter {
  constructor(
    private readonly deps: {
      vehicleMasterRepo: VehicleMasterRepository;
      driverMasterRepo: DriverMasterRepository;
      rateMasterRepo: RateMasterRepository;
      actorId: string | null;
    },
  ) {}

  async write(input: {
    targetKind: MasterEditTargetKind;
    targetKey: string;
    field: string;
    value: string | null;
  }): Promise<void> {
    if (input.targetKind === "rate") return this.writeRate(input.targetKey, input.value);
    if (input.targetKind === "vehicle") return this.writeVehicle(input.targetKey, input.field, input.value);
    return this.writeDriver(input.targetKey, input.field, input.value);
  }

  private async writeRate(targetKey: string, value: string | null): Promise<void> {
    const { key, yearMonth } = splitRateKey(targetKey);
    const num = Number(value ?? "");
    if (!Number.isFinite(num)) throw new Error("数字で入れてください");
    await this.deps.rateMasterRepo.setRate(key, yearMonth, num, this.deps.actorId);
  }

  private async writeVehicle(vehicleNo: string, field: string, value: string | null): Promise<void> {
    if (!(EDITABLE_VEHICLE_FIELDS as readonly string[]).includes(field)) {
      throw new Error("この項目は画面からは直せません");
    }

    // けん引先だけは専用の入口がある (解除を null で表せるようにするため)
    if (field === "towedByVehicleNo") {
      const trimmed = (value ?? "").trim();
      await this.deps.vehicleMasterRepo.updateTowedBy(vehicleNo, trimmed === "" ? null : trimmed);
      return;
    }

    const all = await this.deps.vehicleMasterRepo.findAllActive();
    const current = all.find((v) => v.vehicleNo === vehicleNo);
    if (!current) throw new Error("その車番が車両マスタにありません");

    let parsed: string | number = value ?? "";
    if (NUMERIC_VEHICLE_FIELDS.has(field)) {
      const num = Number(String(value ?? "").replace(/[,\s]/g, ""));
      if (!Number.isFinite(num)) throw new Error("数字で入れてください");
      parsed = num;
    }

    await this.deps.vehicleMasterRepo.upsertMany([
      {
        vehicleNo: current.vehicleNo,
        vehicleType: current.vehicleType,
        depot: current.depot,
        costCategory: current.costCategory,
        insCompulsory: current.insCompulsory,
        insVoluntary: current.insVoluntary,
        taxAuto: current.taxAuto,
        taxWeight: current.taxWeight,
        lease: current.lease,
        installment: current.installment,
        towedByVehicleNo: current.towedByVehicleNo ?? null,
        [field]: parsed,
      },
    ]);
  }

  private async writeDriver(employeeCode: string, field: string, value: string | null): Promise<void> {
    if (!(EDITABLE_DRIVER_FIELDS as readonly string[]).includes(field)) {
      throw new Error("この項目は画面からは直せません");
    }

    const all = await this.deps.driverMasterRepo.findAll();
    const current = all.find((d) => d.employeeCode === employeeCode);
    if (!current) throw new Error("その社員コードが運転者マスタにありません");

    const next = {
      employeeCode: current.employeeCode,
      driverName: current.driverName,
      vehicleNo: current.vehicleNo,
    };
    if (field === "driverName") {
      const name = (value ?? "").trim();
      if (name === "") throw new Error("氏名を入れてください");
      next.driverName = name;
    } else {
      const no = (value ?? "").trim();
      // 空にすると未割当。給与がどの車にも乗らなくなるので、画面側でも警告を出す
      next.vehicleNo = no === "" ? null : no;
    }

    await this.deps.driverMasterRepo.upsertMany([next]);
  }
}
