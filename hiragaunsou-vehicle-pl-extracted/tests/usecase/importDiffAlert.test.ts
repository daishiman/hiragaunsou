import { describe, expect, it } from "vitest";
import {
  DetectImportDiffUseCase,
  driverToComparable,
  vehicleToComparable,
  type ImportCompareSnapshotRepository,
  type ImportDiffAbsorbedRepository,
  type ImportDiffAckRepository,
} from "../../src/usecase/steps/importDiffAlert";
import type { AbsorbedDiff, ComparableRecord, ImportDiffTargetKind } from "../../src/domain/rules/importDiffDetection";
import type {
  DriverMasterRecord,
  VehicleMasterRecord,
} from "../../src/domain/repositories/MasterRepository";

/**
 * 取込のたびに出す「前回と異なります」の組み立てを検証する。
 *
 * ここで見たいのは判定そのものではなく (それは tests/domain/importDiffDetection.test.ts)、
 *   1. 前回の写しと突き合わせていること
 *   2. 写しを更新するのは取込直後だけで、画面の再表示では更新しないこと
 *   3. 確認済みにしたものが二度と出てこないこと
 *   4. 書き方が違うだけの差分は画面に出さず、裏に記録だけ残すこと
 * の4点。
 */

function vehicle(over: Partial<VehicleMasterRecord> & { vehicleNo: string }): VehicleMasterRecord {
  return {
    vehicleType: "大型",
    depot: "本社",
    regDate: null,
    costCategory: "large",
    insCompulsory: 0,
    insVoluntary: 0,
    taxAuto: 0,
    taxWeight: 0,
    lease: 0,
    installment: 0,
    towedByVehicleNo: null,
    ...over,
  };
}

function driver(over: Partial<DriverMasterRecord> & { employeeCode: string }): DriverMasterRecord {
  return { driverName: "田中一郎", vehicleNo: "1111", ...over };
}

class MemorySnapshotRepo implements ImportCompareSnapshotRepository {
  saved: { targetKind: ImportDiffTargetKind; count: number }[] = [];
  constructor(private readonly store = new Map<string, ComparableRecord[]>()) {}
  async find(targetKind: ImportDiffTargetKind) {
    return this.store.get(targetKind) ?? null;
  }
  async save(targetKind: ImportDiffTargetKind, records: readonly ComparableRecord[]) {
    this.store.set(targetKind, [...records]);
    this.saved.push({ targetKind, count: records.length });
  }
}

class MemoryAckRepo implements ImportDiffAckRepository {
  constructor(public fingerprints: string[] = []) {}
  async listFingerprints() {
    return this.fingerprints;
  }
  async ack(input: { fingerprint: string }) {
    this.fingerprints.push(input.fingerprint);
  }
  async unack(fingerprint: string) {
    this.fingerprints = this.fingerprints.filter((f) => f !== fingerprint);
  }
}

class MemoryAbsorbedRepo implements ImportDiffAbsorbedRepository {
  items: AbsorbedDiff[] = [];
  async record(items: readonly AbsorbedDiff[]) {
    this.items.push(...items);
  }
  async list() {
    return this.items.map((i) => ({ ...i, absorbedAt: 0 }));
  }
}

function buildUseCase(input: {
  vehicles?: VehicleMasterRecord[];
  drivers?: DriverMasterRecord[];
  previousVehicles?: VehicleMasterRecord[];
  previousDrivers?: DriverMasterRecord[];
  acked?: string[];
}) {
  const store = new Map<ImportDiffTargetKind, ComparableRecord[]>();
  if (input.previousVehicles) store.set("vehicle", input.previousVehicles.map(vehicleToComparable));
  if (input.previousDrivers) store.set("driver", input.previousDrivers.map(driverToComparable));

  const snapshotRepo = new MemorySnapshotRepo(store);
  const ackRepo = new MemoryAckRepo(input.acked ?? []);
  const absorbedRepo = new MemoryAbsorbedRepo();

  const useCase = new DetectImportDiffUseCase({
    vehicleMasterRepo: {
      findAllActive: async () => input.vehicles ?? [],
    } as never,
    driverMasterRepo: {
      findAll: async () => input.drivers ?? [],
    } as never,
    snapshotRepo,
    ackRepo,
    absorbedRepo,
  });

  return { useCase, snapshotRepo, ackRepo, absorbedRepo };
}

describe("DetectImportDiffUseCase", () => {
  it("はじめての取込では「前回と異なります」を出さない(比べる相手がいない)", async () => {
    const { useCase } = buildUseCase({
      vehicles: [vehicle({ vehicleNo: "1111" })],
      drivers: [driver({ employeeCode: "0093" })],
    });

    const alert = await useCase.execute({ persist: true });

    expect(alert.diffs).toEqual([]);
  });

  it("実質的な変更は「前回と異なります」として出る", async () => {
    const { useCase } = buildUseCase({
      previousDrivers: [driver({ employeeCode: "0093", driverName: "田中一郎", vehicleNo: "1111" })],
      drivers: [driver({ employeeCode: "0093", driverName: "田中一郎", vehicleNo: "2222" })],
    });

    const alert = await useCase.execute();

    expect(alert.diffs.map((d) => [d.kind, d.before, d.after])).toEqual([
      ["link_changed", "1111", "2222"],
    ]);
  });

  it("表記のゆれだけの差分は画面に出さず、裏に記録だけ残す", async () => {
    const { useCase, absorbedRepo } = buildUseCase({
      previousDrivers: [driver({ employeeCode: "0093", driverName: "田中一郎", vehicleNo: "1111" })],
      // 姓名の間の空白・車番のゼロ埋めが違うだけで、指しているものは同じ
      drivers: [driver({ employeeCode: "93", driverName: "田中 一郎", vehicleNo: "0001111" })],
    });

    const alert = await useCase.execute({ persist: true });

    expect(alert.diffs).toEqual([]);
    expect(absorbedRepo.items.map((i) => i.field).sort()).toEqual(["driverName", "vehicleNo"]);
    expect(alert.absorbedCount).toBe(2);
  });

  it("車番が外れて未割当になったら強く出す", async () => {
    const { useCase } = buildUseCase({
      previousDrivers: [driver({ employeeCode: "0093", vehicleNo: "1111" })],
      drivers: [driver({ employeeCode: "0093", vehicleNo: null })],
    });

    const alert = await useCase.execute();

    expect(alert.criticalCount).toBe(1);
    expect(alert.diffs[0]!.kind).toBe("unassigned");
  });

  it("前回はあったのに今回消えている行を見つける", async () => {
    const { useCase } = buildUseCase({
      previousDrivers: [
        driver({ employeeCode: "0093", driverName: "田中一郎" }),
        driver({ employeeCode: "0094", driverName: "鈴木二郎", vehicleNo: "2222" }),
      ],
      drivers: [driver({ employeeCode: "0093", driverName: "田中一郎" })],
    });

    const alert = await useCase.execute();

    expect(alert.diffs.map((d) => [d.kind, d.targetLabel])).toContainEqual([
      "row_removed",
      "鈴木二郎",
    ]);
  });

  it("金額の桁が前回と違うときは強く出す", async () => {
    const { useCase } = buildUseCase({
      previousVehicles: [vehicle({ vehicleNo: "1111", lease: 120000 })],
      vehicles: [vehicle({ vehicleNo: "1111", lease: 1200000 })],
    });

    const alert = await useCase.execute();

    expect(alert.diffs.map((d) => [d.kind, d.fieldLabel])).toEqual([["digit_jump", "リース料"]]);
  });

  it("確認済みにした差分は次から表示されない", async () => {
    const first = buildUseCase({
      previousDrivers: [driver({ employeeCode: "0093", vehicleNo: "1111" })],
      drivers: [driver({ employeeCode: "0093", vehicleNo: "2222" })],
    });
    const alert = await first.useCase.execute();
    const fingerprint = alert.diffs[0]!.fingerprint;

    const second = buildUseCase({
      previousDrivers: [driver({ employeeCode: "0093", vehicleNo: "1111" })],
      drivers: [driver({ employeeCode: "0093", vehicleNo: "2222" })],
      acked: [fingerprint],
    });

    expect((await second.useCase.execute()).diffs).toEqual([]);
  });

  it("同じ項目でも別の値に変わったら、確認済みを越えてもう一度出す", async () => {
    const first = buildUseCase({
      previousDrivers: [driver({ employeeCode: "0093", vehicleNo: "1111" })],
      drivers: [driver({ employeeCode: "0093", vehicleNo: "2222" })],
    });
    const fingerprint = (await first.useCase.execute()).diffs[0]!.fingerprint;

    // 同じ「乗っている車が変わった」でも、行き先が 3333 に変わったのは新しい知らせ
    const second = buildUseCase({
      previousDrivers: [driver({ employeeCode: "0093", vehicleNo: "1111" })],
      drivers: [driver({ employeeCode: "0093", vehicleNo: "3333" })],
      acked: [fingerprint],
    });

    expect((await second.useCase.execute()).diffs).toHaveLength(1);
  });

  it("書き方が違うだけの二重登録を見つける(片方だけ直して食い違うのを防ぐ)", async () => {
    const { useCase } = buildUseCase({
      previousDrivers: [driver({ employeeCode: "0093", driverName: "田中一郎" })],
      drivers: [
        driver({ employeeCode: "0093", driverName: "田中一郎" }),
        driver({ employeeCode: "0195", driverName: "田中 一郎", vehicleNo: "2222" }),
      ],
    });

    const alert = await useCase.execute();

    const duplicate = alert.diffs.find((d) => d.kind === "duplicate_candidate");
    expect(duplicate).toBeDefined();
    expect(duplicate!.counterpartLabel).toBe("田中 一郎");
  });

  it("1〜2文字違いは自動で同じにせず「もしかして同じ?」として出すだけ", async () => {
    const { useCase } = buildUseCase({
      previousDrivers: [driver({ employeeCode: "0093", driverName: "田中一郎" })],
      drivers: [
        driver({ employeeCode: "0093", driverName: "田中一郎" }),
        driver({ employeeCode: "0195", driverName: "田仲一郎", vehicleNo: "2222" }),
      ],
    });

    const alert = await useCase.execute();

    const near = alert.diffs.find((d) => d.kind === "near_match");
    expect(near).toBeDefined();
    // 別人でありうるので、強く出して作業を止めることはしない
    expect(near!.severity).toBe("caution");
  });

  it("取込直後は写しを更新し、画面の再表示では更新しない", async () => {
    const persisted = buildUseCase({ drivers: [driver({ employeeCode: "0093" })] });
    await persisted.useCase.execute({ persist: true });
    expect(persisted.snapshotRepo.saved.map((s) => s.targetKind)).toEqual(["vehicle", "driver"]);

    const readOnly = buildUseCase({ drivers: [driver({ employeeCode: "0093" })] });
    await readOnly.useCase.execute({ persist: false });
    expect(readOnly.snapshotRepo.saved).toEqual([]);
  });

  it("強く出すものが先に並ぶ(下に埋もれると読まれない)", async () => {
    const { useCase } = buildUseCase({
      previousDrivers: [
        driver({ employeeCode: "0093", driverName: "田中一郎", vehicleNo: "1111" }),
        driver({ employeeCode: "0094", driverName: "鈴木二郎", vehicleNo: "2222" }),
      ],
      drivers: [
        driver({ employeeCode: "0093", driverName: "田中太郎", vehicleNo: "1111" }),
        driver({ employeeCode: "0094", driverName: "鈴木二郎", vehicleNo: null }),
      ],
    });

    const alert = await useCase.execute();

    expect(alert.diffs[0]!.severity).toBe("critical");
    expect(alert.diffs.at(-1)!.severity).toBe("caution");
  });
});
