import { describe, it, expect } from "vitest";
import { D1MasterValueWriter } from "../../../src/infrastructure/db/D1MasterValueWriter";

/**
 * 1件だけ直す入口の書き戻し。
 *
 * ここで押さえたいのは「車両マスタに無い車番を運転者に付けようとしたとき」。
 * 実際にDBまで届くと英語の参照エラーがそのまま画面に出てしまい、読んだ人は
 * 何を直せばいいのか分からない。届く前に言葉で止めることを固定する。
 */
function buildWriter(overrides?: {
  vehicles?: { vehicleNo: string }[];
  drivers?: { employeeCode: string; driverName: string; vehicleNo: string | null }[];
}) {
  const vehicles = overrides?.vehicles ?? [{ vehicleNo: "24" }, { vehicleNo: "300" }];
  const drivers =
    overrides?.drivers ?? [{ employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "300" }];
  const upserted: unknown[] = [];

  const writer = new D1MasterValueWriter({
    vehicleMasterRepo: {
      findAllActive: async () => vehicles,
      upsertMany: async (rows: unknown[]) => {
        upserted.push(...rows);
      },
      updateTowedBy: async () => {},
    } as never,
    driverMasterRepo: {
      findAll: async () => drivers,
      upsertMany: async (rows: unknown[]) => {
        upserted.push(...rows);
      },
    } as never,
    rateMasterRepo: { setRate: async () => {} } as never,
    actorId: "u1",
  });

  return { writer, upserted };
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
});
