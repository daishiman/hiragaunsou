import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1VehicleMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import type { VehicleMasterUpsertInput } from "../../../src/domain/repositories/MasterRepository";

function makeInput(overrides: Partial<VehicleMasterUpsertInput> = {}): VehicleMasterUpsertInput {
  return {
    vehicleNo: "1111",
    vehicleType: "大型ウイング",
    depot: "本社",
    costCategory: "large",
    insCompulsory: 1530,
    insVoluntary: 12000,
    taxAuto: 50400,
    taxWeight: 10400,
    lease: 85000,
    installment: 0,
    ...overrides,
  };
}

/** CSV一括取込の書き込み口。upsertMany は .batch() を使わないためこの手法で検証できる。 */
describe("D1VehicleMasterRepository.upsertMany", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  it("未登録の車番は新規登録し、active=trueで入る", async () => {
    const repo = new D1VehicleMasterRepository(ctx.db);
    const result = await repo.upsertMany([makeInput(), makeInput({ vehicleNo: "2222" })]);

    expect(result).toEqual({ inserted: 2, updated: 0 });
    const rows = await repo.findAllActive();
    expect(rows.map((r) => r.vehicleNo).sort()).toEqual(["1111", "2222"]);
    expect(rows.find((r) => r.vehicleNo === "1111")).toMatchObject({
      vehicleType: "大型ウイング",
      depot: "本社",
      costCategory: "large",
      insCompulsory: 1530,
      lease: 85000,
    });
  });

  it("既存の車番は上書き更新し、新規/更新の内訳を返す", async () => {
    const repo = new D1VehicleMasterRepository(ctx.db);
    await repo.upsertMany([makeInput()]);

    const result = await repo.upsertMany([
      makeInput({ vehicleType: "セミトレーラ", costCategory: "semiTrailer", lease: 90000 }),
      makeInput({ vehicleNo: "3333" }),
    ]);

    expect(result).toEqual({ inserted: 1, updated: 1 });
    const rows = await repo.findAllActive();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.vehicleNo === "1111")).toMatchObject({
      vehicleType: "セミトレーラ",
      costCategory: "semiTrailer",
      lease: 90000,
    });
  });

  it("0件なら何も書き込まない", async () => {
    const repo = new D1VehicleMasterRepository(ctx.db);
    expect(await repo.upsertMany([])).toEqual({ inserted: 0, updated: 0 });
    expect(await repo.findAllActive()).toHaveLength(0);
  });
});
