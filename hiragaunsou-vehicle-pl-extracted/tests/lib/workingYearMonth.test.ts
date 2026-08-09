import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "../infrastructure/db/testDbHelper";
import { resolveOverviewYearMonth, resolveWorkingYearMonth } from "../../app/_lib/workingYearMonth";
import { defaultImportYearMonth } from "../../app/_lib/yearMonth";

/**
 * ホームの「次にやること」がどの月の話をするかの判定。
 *
 * 当月固定だったため、5月分を取り込んでもホームは当月の話をし続け、
 * 「4つとも取り込んだのに次に何をすればいいか分からない」状態になっていた。
 * 判定を実データ(取込のある月・締めたかどうか)から行うことをここで固定する。
 */
describe("resolveWorkingYearMonth", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  function addBatch(yearMonth: string, sourceType = "vehicle_operation") {
    ctx.sqlite
      .prepare(
        "INSERT INTO csv_import_batch (id, source_type, year_month, file_name, row_count) VALUES (?, ?, ?, ?, ?)",
      )
      .run(`${yearMonth}-${sourceType}`, sourceType, yearMonth, "a.csv", 10);
  }

  function addPlRow(yearMonth: string, vehicleNo: string, confirmed: boolean) {
    ctx.sqlite
      .prepare(
        "INSERT INTO vehicle_pl (id, year_month, vehicle_no, confirmed) VALUES (?, ?, ?, ?)",
      )
      .run(`${yearMonth}-${vehicleNo}`, yearMonth, vehicleNo, confirmed ? 1 : 0);
  }

  it("取込が1件も無ければ取込画面と同じ既定(前月)に揃える", async () => {
    expect(await resolveWorkingYearMonth(ctx.db)).toBe(defaultImportYearMonth());
  });

  it("取込のある月が1つだけならその月を採る(当月と違っていても)", async () => {
    addBatch("2026-05");
    expect(await resolveWorkingYearMonth(ctx.db)).toBe("2026-05");
  });

  it("締めていない月が複数あれば、最も新しい月を採る", async () => {
    addBatch("2026-04");
    addBatch("2026-05");
    expect(await resolveWorkingYearMonth(ctx.db)).toBe("2026-05");
  });

  it("最新月が締め済みなら、まだ締めていない1つ前の月へ戻る", async () => {
    addBatch("2026-04");
    addBatch("2026-05");
    addPlRow("2026-05", "101", true);
    addPlRow("2026-05", "102", true);
    expect(await resolveWorkingYearMonth(ctx.db)).toBe("2026-04");
  });

  it("収支表が1台でも未確定なら、その月はまだ作業中として扱う", async () => {
    addBatch("2026-05");
    addPlRow("2026-05", "101", true);
    addPlRow("2026-05", "102", false);
    expect(await resolveWorkingYearMonth(ctx.db)).toBe("2026-05");
  });

  it("取込のある月がすべて締め済みなら既定(前月)に戻す", async () => {
    addBatch("2026-05");
    addPlRow("2026-05", "101", true);
    expect(await resolveWorkingYearMonth(ctx.db)).toBe(defaultImportYearMonth());
  });
});

/**
 * ホーム最上段の経営サマリがどの月の話をするか。
 *
 * 前月固定だったため、締めた月が1つも無くても前月の数字を出していた。
 * 本番では取込が1件も無い2026-07に収支表だけが101台分残っていたため、
 * 売上0円・赤字だけの架空のサマリが画面の一番上に出ていた。
 */
describe("resolveOverviewYearMonth", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  function addBatch(yearMonth: string, sourceType = "vehicle_operation") {
    ctx.sqlite
      .prepare(
        "INSERT INTO csv_import_batch (id, source_type, year_month, file_name, row_count) VALUES (?, ?, ?, ?, ?)",
      )
      .run(`${yearMonth}-${sourceType}`, sourceType, yearMonth, "a.csv", 10);
  }

  function addPlRow(yearMonth: string, vehicleNo: string, confirmed: boolean) {
    ctx.sqlite
      .prepare("INSERT INTO vehicle_pl (id, year_month, vehicle_no, confirmed) VALUES (?, ?, ?, ?)")
      .run(`${yearMonth}-${vehicleNo}`, yearMonth, vehicleNo, confirmed ? 1 : 0);
  }

  it("取込が1件も無ければ取込画面と同じ既定(前月)に揃える", async () => {
    expect(await resolveOverviewYearMonth(ctx.db)).toBe(defaultImportYearMonth());
  });

  it("締めた月があれば、その最も新しい月の数字を見せる", async () => {
    addBatch("2026-04");
    addBatch("2026-05");
    addPlRow("2026-04", "101", true);
    expect(await resolveOverviewYearMonth(ctx.db)).toBe("2026-04");
  });

  it("まだ1つも締めていなければ、取込のある最新月の途中経過を見せる", async () => {
    addBatch("2026-04");
    addBatch("2026-05");
    addPlRow("2026-05", "101", false);
    expect(await resolveOverviewYearMonth(ctx.db)).toBe("2026-05");
  });

  it("取込が1件も無い月に収支表だけが残っていても、その月は選ばない", async () => {
    addBatch("2026-05");
    addPlRow("2026-05", "101", false);
    addPlRow("2026-07", "101", false);
    expect(await resolveOverviewYearMonth(ctx.db)).toBe("2026-05");
  });
});
