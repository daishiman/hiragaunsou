import { describe, it, expect, vi } from "vitest";
import {
  D1MasterValueWriter,
  splitRateKey,
} from "../../../src/infrastructure/db/D1MasterValueWriter";

/**
 * 1件だけ直す入口の書き戻し。
 *
 * ここで押さえたいのは「車両マスタに無い車番を運転者に付けようとしたとき」。
 * 実際にDBまで届くと英語の参照エラーがそのまま画面に出てしまい、読んだ人は
 * 何を直せばいいのか分からない。届く前に言葉で止めることを固定する。
 */
/** 車両マスタの1台。直せる項目がすべて埋まっている状態を既定にする */
const VEHICLE_24 = {
  vehicleNo: "24",
  vehicleType: "大型",
  depot: "本社",
  costCategory: "自社",
  insCompulsory: 1000,
  insVoluntary: 2000,
  taxAuto: 3000,
  taxWeight: 4000,
  lease: 5000,
  installment: 6000,
  towedByVehicleNo: null,
};

function buildWriter(overrides?: {
  vehicles?: Record<string, unknown>[];
  drivers?: { employeeCode: string; driverName: string; vehicleNo: string | null }[];
}) {
  const vehicles = overrides?.vehicles ?? [VEHICLE_24, { ...VEHICLE_24, vehicleNo: "300" }];
  const drivers =
    overrides?.drivers ?? [{ employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "300" }];
  const upserted: unknown[] = [];
  const setRate = vi.fn(async () => {});
  const updateTowedBy = vi.fn(async () => {});

  const writer = new D1MasterValueWriter({
    vehicleMasterRepo: {
      findAllActive: async () => vehicles,
      upsertMany: async (rows: unknown[]) => {
        upserted.push(...rows);
      },
      updateTowedBy,
    } as never,
    driverMasterRepo: {
      findAll: async () => drivers,
      upsertMany: async (rows: unknown[]) => {
        upserted.push(...rows);
      },
    } as never,
    rateMasterRepo: { setRate } as never,
    actorId: "u1",
  });

  return { writer, upserted, setRate, updateTowedBy };
}

describe("D1MasterValueWriter: 運転者の乗っている車を直す", () => {
  it("車両マスタにある車番なら書き戻す", async () => {
    const { writer, upserted } = buildWriter();

    await writer.write({
      targetKind: "driver",
      targetKey: "1002",
      field: "vehicleNo",
      value: "24",
    });

    expect(upserted).toEqual([
      { employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "24" },
    ]);
  });

  it("車両マスタに無い車番は、何をすればいいか分かる言葉で止める", async () => {
    const { writer, upserted } = buildWriter();

    await expect(
      writer.write({ targetKind: "driver", targetKey: "1002", field: "vehicleNo", value: "999" }),
    ).rejects.toThrow("車番 999 は車両マスタにありません。先に車両マスタへ登録してください");
    expect(upserted).toEqual([]);
  });

  it("空にしたときは未割当として保存する(照合はしない)", async () => {
    const { writer, upserted } = buildWriter();

    await writer.write({ targetKind: "driver", targetKey: "1002", field: "vehicleNo", value: "" });

    expect(upserted).toEqual([
      { employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: null },
    ]);
  });

  it("氏名を直すときは車両マスタを見に行かない", async () => {
    const { writer, upserted } = buildWriter({ vehicles: [] });

    await writer.write({
      targetKind: "driver",
      targetKey: "1002",
      field: "driverName",
      value: "鈴木 一郎",
    });

    expect(upserted).toEqual([
      { employeeCode: "1002", driverName: "鈴木 一郎", vehicleNo: "300" },
    ]);
  });

  it("運転者の一覧に無い社員コードは止める", async () => {
    const { writer } = buildWriter({ drivers: [] });

    await expect(
      writer.write({ targetKind: "driver", targetKey: "1002", field: "driverName", value: "x" }),
    ).rejects.toThrow("その社員コードが運転者マスタにありません");
  });

  it("氏名を空にはできない(誰の行か分からなくなる)", async () => {
    const { writer } = buildWriter();

    await expect(
      writer.write({ targetKind: "driver", targetKey: "1002", field: "driverName", value: "   " }),
    ).rejects.toThrow("氏名を入れてください");
  });

  it("運転者マスタの一覧に無い項目は直せない", async () => {
    const { writer } = buildWriter();

    await expect(
      writer.write({ targetKind: "driver", targetKey: "1002", field: "depot", value: "本社" }),
    ).rejects.toThrow("この項目は画面からは直せません");
  });
});

describe("D1MasterValueWriter: 車両マスタを1項目だけ直す", () => {
  it("金額はカンマ付きで入れても数字として保存する", async () => {
    const { writer, upserted } = buildWriter();

    await writer.write({
      targetKind: "vehicle",
      targetKey: "24",
      field: "lease",
      value: "12,000",
    });

    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({ vehicleNo: "24", lease: 12000, taxAuto: 3000 });
  });

  it("金額に数字でないものを入れたら止める", async () => {
    const { writer, upserted } = buildWriter();

    await expect(
      writer.write({ targetKind: "vehicle", targetKey: "24", field: "taxAuto", value: "いくらか" }),
    ).rejects.toThrow("数字で入れてください");
    expect(upserted).toEqual([]);
  });

  it("文字の項目はそのまま保存する", async () => {
    const { writer, upserted } = buildWriter();

    await writer.write({
      targetKind: "vehicle",
      targetKey: "24",
      field: "depot",
      value: "北営業所",
    });

    expect(upserted[0]).toMatchObject({ vehicleNo: "24", depot: "北営業所" });
  });

  it("一覧に無い項目は直せない", async () => {
    const { writer } = buildWriter();

    await expect(
      writer.write({ targetKind: "vehicle", targetKey: "24", field: "driverName", value: "x" }),
    ).rejects.toThrow("この項目は画面からは直せません");
  });

  it("マスタに無い車番は止める", async () => {
    const { writer } = buildWriter({ vehicles: [] });

    await expect(
      writer.write({ targetKind: "vehicle", targetKey: "24", field: "lease", value: "1" }),
    ).rejects.toThrow("その車番が車両マスタにありません");
  });

  /** けん引先だけは「外す」を空で表せる必要があるので、専用の入口を通す */
  it("けん引するトラクタは専用の入口で保存し、空なら外す", async () => {
    const { writer, updateTowedBy, upserted } = buildWriter();

    await writer.write({
      targetKind: "vehicle",
      targetKey: "300",
      field: "towedByVehicleNo",
      value: " 24 ",
    });
    await writer.write({
      targetKind: "vehicle",
      targetKey: "300",
      field: "towedByVehicleNo",
      value: "",
    });

    expect(updateTowedBy.mock.calls).toEqual([
      ["300", "24"],
      ["300", null],
    ]);
    expect(upserted).toEqual([]);
  });
});

describe("D1MasterValueWriter: 率を直す", () => {
  it("月を付けたキーはその月の値として保存する", async () => {
    const { writer, setRate } = buildWriter();

    await writer.write({
      targetKind: "rate",
      targetKey: "admin_fee_rate|2026-05",
      field: "value",
      value: "0.1748",
    });

    expect(setRate).toHaveBeenCalledWith("admin_fee_rate", "2026-05", 0.1748, "u1");
  });

  it("月が付いていなければ全期間共通の値として保存する", async () => {
    const { writer, setRate } = buildWriter();

    await writer.write({
      targetKind: "rate",
      targetKey: "admin_fee_rate",
      field: "value",
      value: "0.1748",
    });

    expect(setRate).toHaveBeenCalledWith("admin_fee_rate", null, 0.1748, "u1");
  });

  it("数字でない値は止める", async () => {
    const { writer, setRate } = buildWriter();

    await expect(
      writer.write({
        targetKind: "rate",
        targetKey: "admin_fee_rate",
        field: "value",
        value: "約2割",
      }),
    ).rejects.toThrow("数字で入れてください");
    expect(setRate).not.toHaveBeenCalled();
  });

  it("月として読めない形は全期間共通として扱う(勝手に別の月にしない)", () => {
    expect(splitRateKey("admin_fee_rate|2026-13")).toEqual({
      key: "admin_fee_rate",
      yearMonth: null,
    });
    expect(splitRateKey("admin_fee_rate|2026-05")).toEqual({
      key: "admin_fee_rate",
      yearMonth: "2026-05",
    });
  });
});
