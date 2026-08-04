import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import {
  D1AppSettingRepository,
  D1CleansingDecisionRepository,
} from "../../../src/infrastructure/db/D1CleansingDecisionRepository";
import type { CleansingDecisionRecord } from "../../../src/domain/repositories/CleansingDecisionRepository";

/**
 * D1CleansingDecisionRepository / D1AppSettingRepository を
 * in-memory sqlite (better-sqlite3 + drizzle) で検証する。
 * upsertMany は D1固有の `.batch()` を使うため、この手法では検証できない(既存の制約。対象外)。
 * 代わりに findByYearMonth / countByYearMonth / findPreviousDecisions と、
 * upsertMany が使う SQL 断片の意味論を直接 insert して検証する。
 */
function insertDecision(sqlite: ReturnType<typeof createTestDb>["sqlite"], row: {
  id: string;
  yearMonth: string;
  sourceType: string;
  rowKey: string;
  vehicleNo: string | null;
  driverName: string | null;
  flagTypes: string;
  decision: string;
  correctedVehicleNo: string | null;
  note: string | null;
}) {
  sqlite
    .prepare(
      `INSERT INTO cleansing_decision
        (id, year_month, source_type, row_key, vehicle_no, driver_name, flag_types, decision, corrected_vehicle_no, note)
       VALUES (@id, @yearMonth, @sourceType, @rowKey, @vehicleNo, @driverName, @flagTypes, @decision, @correctedVehicleNo, @note)`,
    )
    .run(row);
}

describe("D1CleansingDecisionRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  describe("findByYearMonth", () => {
    it("該当年月・帳票種別の行だけを返し、flagTypesはJSONとしてパースされる", async () => {
      insertDecision(ctx.sqlite, {
        id: "1",
        yearMonth: "2026-05",
        sourceType: "sales_monitor",
        rowKey: "K-1",
        vehicleNo: "24",
        driverName: "山田",
        flagTypes: JSON.stringify(["duplicate_suspect"]),
        decision: "keep",
        correctedVehicleNo: null,
        note: null,
      });
      insertDecision(ctx.sqlite, {
        id: "2",
        yearMonth: "2026-04",
        sourceType: "sales_monitor",
        rowKey: "K-2",
        vehicleNo: "24",
        driverName: null,
        flagTypes: JSON.stringify([]),
        decision: "delete",
        correctedVehicleNo: null,
        note: null,
      });

      const repo = new D1CleansingDecisionRepository(ctx.db);
      const rows = await repo.findByYearMonth("2026-05", "sales_monitor");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        rowKey: "K-1",
        flagTypes: ["duplicate_suspect"],
        decision: "keep",
      });
    });

    it("対象が無ければ空配列を返す", async () => {
      const repo = new D1CleansingDecisionRepository(ctx.db);
      expect(await repo.findByYearMonth("2026-05", "sales_monitor")).toEqual([]);
    });
  });

  describe("countByYearMonth", () => {
    it("該当年月・帳票種別の件数だけを数える(他の月・帳票は含めない)", async () => {
      insertDecision(ctx.sqlite, {
        id: "1",
        yearMonth: "2026-05",
        sourceType: "sales_monitor",
        rowKey: "K-1",
        vehicleNo: "24",
        driverName: null,
        flagTypes: "[]",
        decision: "keep",
        correctedVehicleNo: null,
        note: null,
      });
      insertDecision(ctx.sqlite, {
        id: "2",
        yearMonth: "2026-05",
        sourceType: "payroll",
        rowKey: "K-2",
        vehicleNo: "24",
        driverName: null,
        flagTypes: "[]",
        decision: "keep",
        correctedVehicleNo: null,
        note: null,
      });
      const repo = new D1CleansingDecisionRepository(ctx.db);
      expect(await repo.countByYearMonth("2026-05", "sales_monitor")).toBe(1);
    });

    it("0件のときは0を返す", async () => {
      const repo = new D1CleansingDecisionRepository(ctx.db);
      expect(await repo.countByYearMonth("2026-05", "sales_monitor")).toBe(0);
    });
  });

  describe("findPreviousDecisions", () => {
    it("空配列を渡すと即座に空配列を返す(クエリを発行しない)", async () => {
      const repo = new D1CleansingDecisionRepository(ctx.db);
      expect(await repo.findPreviousDecisions("sales_monitor", [], "2026-05")).toEqual([]);
    });

    it("指定年月より前の最新の判断だけをrowKeyごとに1件返す", async () => {
      insertDecision(ctx.sqlite, {
        id: "1",
        yearMonth: "2026-03",
        sourceType: "sales_monitor",
        rowKey: "K-1",
        vehicleNo: "24",
        driverName: null,
        flagTypes: "[]",
        decision: "keep",
        correctedVehicleNo: null,
        note: "old",
      });
      insertDecision(ctx.sqlite, {
        id: "2",
        yearMonth: "2026-04",
        sourceType: "sales_monitor",
        rowKey: "K-1",
        vehicleNo: "24",
        driverName: null,
        flagTypes: "[]",
        decision: "delete",
        correctedVehicleNo: null,
        note: "new",
      });
      // beforeYearMonth以降(同月含む)は除外される
      insertDecision(ctx.sqlite, {
        id: "3",
        yearMonth: "2026-05",
        sourceType: "sales_monitor",
        rowKey: "K-1",
        vehicleNo: "24",
        driverName: null,
        flagTypes: "[]",
        decision: "correct",
        correctedVehicleNo: "300",
        note: "future",
      });

      const repo = new D1CleansingDecisionRepository(ctx.db);
      const rows = await repo.findPreviousDecisions("sales_monitor", ["K-1"], "2026-05");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.note).toBe("new");
    });

    it("IN_CHUNK_SIZE(90)を超えるrowKeysでも分割して全件拾える", async () => {
      const rowKeys = Array.from({ length: 95 }, (_, i) => `K-${i}`);
      for (const key of rowKeys) {
        insertDecision(ctx.sqlite, {
          id: key,
          yearMonth: "2026-04",
          sourceType: "sales_monitor",
          rowKey: key,
          vehicleNo: "24",
          driverName: null,
          flagTypes: "[]",
          decision: "keep",
          correctedVehicleNo: null,
          note: null,
        });
      }
      const repo = new D1CleansingDecisionRepository(ctx.db);
      const rows = await repo.findPreviousDecisions("sales_monitor", rowKeys, "2026-05");
      expect(rows).toHaveLength(95);
    });

    it("sourceTypeが異なる行は含めない", async () => {
      insertDecision(ctx.sqlite, {
        id: "1",
        yearMonth: "2026-04",
        sourceType: "payroll",
        rowKey: "K-1",
        vehicleNo: "24",
        driverName: null,
        flagTypes: "[]",
        decision: "keep",
        correctedVehicleNo: null,
        note: null,
      });
      const repo = new D1CleansingDecisionRepository(ctx.db);
      expect(await repo.findPreviousDecisions("sales_monitor", ["K-1"], "2026-05")).toEqual([]);
    });
  });

  describe("upsertMany", () => {
    it("records.length===0のときは何もせず正常終了する", async () => {
      const repo = new D1CleansingDecisionRepository(ctx.db);
      await expect(repo.upsertMany([], null)).resolves.toBeUndefined();
    });

    it("1件以上ではD1固有の.batch()を呼ぶ(better-sqlite3ドライバに無いため例外になる)", async () => {
      const repo = new D1CleansingDecisionRepository(ctx.db);
      const record: CleansingDecisionRecord = {
        yearMonth: "2026-05",
        sourceType: "sales_monitor",
        rowKey: "K-1",
        vehicleNo: "24",
        driverName: null,
        flagTypes: [],
        decision: "keep",
        correctedVehicleNo: null,
        note: null,
      };
      // better-sqlite3ドライバは`.batch()`を持たないため、D1向け実装をこの技法で最後まで
      // 検証することはできない(tests/infrastructure/newD1Methods.test.tsに記載の既知の制約)。
      await expect(repo.upsertMany([record], "user-1")).rejects.toThrow();
    });
  });
});

describe("D1AppSettingRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  it("未設定のキーはnullを返す", async () => {
    const repo = new D1AppSettingRepository(ctx.db);
    expect(await repo.get("kirin_target_vehicle_nos")).toBeNull();
  });

  it("setで新規insertし、getで読み出せる", async () => {
    const repo = new D1AppSettingRepository(ctx.db);
    await repo.set("kirin_target_vehicle_nos", "24,300", null);
    expect(await repo.get("kirin_target_vehicle_nos")).toBe("24,300");
  });

  it("同じキーへの再setは重複行を作らずupdateする", async () => {
    const repo = new D1AppSettingRepository(ctx.db);
    await repo.set("kirin_target_vehicle_nos", "24", null);
    await repo.set("kirin_target_vehicle_nos", "300", null);
    expect(await repo.get("kirin_target_vehicle_nos")).toBe("300");
    const rows = ctx.sqlite.prepare("SELECT * FROM app_setting").all();
    expect(rows).toHaveLength(1);
  });
});
