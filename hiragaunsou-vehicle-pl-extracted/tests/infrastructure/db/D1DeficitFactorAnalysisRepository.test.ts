import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1DeficitFactorAnalysisRepository } from "../../../src/infrastructure/db/D1DeficitFactorAnalysisRepository";
import type { DeficitFactorAnalysisUpsertInput } from "../../../src/domain/repositories/DeficitFactorAnalysisRepository";

describe("D1DeficitFactorAnalysisRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  const input: DeficitFactorAnalysisUpsertInput = {
    vehicleNo: "24",
    yearMonth: "2026-05",
    summary: "燃料費が高い",
    factors: [
      { category: "fuelTotal", direction: "high", amountYen: 50000, explanation: "燃料単価上昇" },
    ],
    model: "claude-haiku-4-5",
  };

  describe("findByYearMonth", () => {
    it("該当月の分析結果が無ければ空配列を返す", async () => {
      const repo = new D1DeficitFactorAnalysisRepository(ctx.db);
      expect(await repo.findByYearMonth("2026-05")).toEqual([]);
    });

    it("upsertMany後、factorsがJSONからパースされた状態で取得できる", async () => {
      const repo = new D1DeficitFactorAnalysisRepository(ctx.db);
      await repo.upsertMany([input], null);
      const rows = await repo.findByYearMonth("2026-05");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        vehicleNo: "24",
        yearMonth: "2026-05",
        summary: "燃料費が高い",
        model: "claude-haiku-4-5",
      });
      expect(rows[0]?.factors).toEqual(input.factors);
      expect(typeof rows[0]?.updatedAt).toBe("number");
    });

    it("他の月の結果は含めない", async () => {
      const repo = new D1DeficitFactorAnalysisRepository(ctx.db);
      await repo.upsertMany([input], null);
      expect(await repo.findByYearMonth("2026-04")).toEqual([]);
    });
  });

  describe("findOne", () => {
    it("該当車両×月が無ければnullを返す", async () => {
      const repo = new D1DeficitFactorAnalysisRepository(ctx.db);
      expect(await repo.findOne("24", "2026-05")).toBeNull();
    });

    it("該当車両×月の1件を返す", async () => {
      const repo = new D1DeficitFactorAnalysisRepository(ctx.db);
      await repo.upsertMany([input], null);
      const row = await repo.findOne("24", "2026-05");
      expect(row?.summary).toBe("燃料費が高い");
    });

    it("車番が一致しても月が違えば返さない", async () => {
      const repo = new D1DeficitFactorAnalysisRepository(ctx.db);
      await repo.upsertMany([input], null);
      expect(await repo.findOne("24", "2026-04")).toBeNull();
    });
  });

  describe("upsertMany", () => {
    it("空配列を渡すとループが1度も回らず正常終了する", async () => {
      const repo = new D1DeficitFactorAnalysisRepository(ctx.db);
      await expect(repo.upsertMany([], null)).resolves.toBeUndefined();
      expect(await repo.findByYearMonth("2026-05")).toEqual([]);
    });

    it("同一車両×月への再upsertは行を増やさず、内容を丸ごと置き換える(部分更新ではない)", async () => {
      const repo = new D1DeficitFactorAnalysisRepository(ctx.db);
      await repo.upsertMany([input], null);
      await repo.upsertMany(
        [
          {
            ...input,
            summary: "修繕費が高い",
            factors: [
              { category: "repairTotal", direction: "high", amountYen: 30000, explanation: "突発修繕" },
            ],
            model: "claude-opus-4",
          },
        ],
        null,
      );
      const rows = await repo.findByYearMonth("2026-05");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.summary).toBe("修繕費が高い");
      expect(rows[0]?.model).toBe("claude-opus-4");
      expect(rows[0]?.factors).toEqual([
        { category: "repairTotal", direction: "high", amountYen: 30000, explanation: "突発修繕" },
      ]);
    });

    it("複数台分を一度に処理する(1台ずつawaitでループしている実装を検証)", async () => {
      const repo = new D1DeficitFactorAnalysisRepository(ctx.db);
      await repo.upsertMany(
        [input, { ...input, vehicleNo: "300", summary: "労務費が高い" }],
        null,
      );
      const rows = await repo.findByYearMonth("2026-05");
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.vehicleNo).sort()).toEqual(["24", "300"]);
    });
  });
});
