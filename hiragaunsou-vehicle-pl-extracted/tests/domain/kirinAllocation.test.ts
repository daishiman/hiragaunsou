import { describe, it, expect } from "vitest";
import {
  allocateKirinSupport,
  DEFAULT_KIRIN_TARGET_VEHICLES,
} from "../../src/domain/rules/kirinAllocation";

/**
 * 業務フロー STEP2: キリンの輸送協力金・経営支援金を2等分し、
 * 専属の24番・300番の「その他」へ入れる。
 */
describe("allocateKirinSupport", () => {
  it("既定の配賦先は24番と300番(専属の2台)", () => {
    expect(DEFAULT_KIRIN_TARGET_VEHICLES).toEqual(["24", "300"]);
  });

  it("協力金と支援金の合計を2等分する", () => {
    const result = allocateKirinSupport({ transportSupport: 600_000, managementSupport: 400_000 });
    expect(result).toEqual([
      { vehicleNo: "24", amount: 500_000 },
      { vehicleNo: "300", amount: 500_000 },
    ]);
  });

  it("割り切れない1円は先頭の車両へ寄せる(合計が必ず一致する)", () => {
    const result = allocateKirinSupport({ transportSupport: 1_001, managementSupport: 0 });
    expect(result).toEqual([
      { vehicleNo: "24", amount: 501 },
      { vehicleNo: "300", amount: 500 },
    ]);
    expect(result[0]!.amount + result[1]!.amount).toBe(1_001);
  });

  it("金額が0なら配賦しない(0円行を作らない)", () => {
    expect(allocateKirinSupport({ transportSupport: 0, managementSupport: 0 })).toEqual([]);
  });

  it("配賦先を明示指定できる(専属車両が変わったとき)", () => {
    const result = allocateKirinSupport({
      transportSupport: 300,
      managementSupport: 0,
      targetVehicleNos: ["7"],
    });
    expect(result).toEqual([{ vehicleNo: "7", amount: 300 }]);
  });

  it("配賦先が空なら何も返さない", () => {
    expect(
      allocateKirinSupport({ transportSupport: 100, managementSupport: 0, targetVehicleNos: [] }),
    ).toEqual([]);
  });
});
