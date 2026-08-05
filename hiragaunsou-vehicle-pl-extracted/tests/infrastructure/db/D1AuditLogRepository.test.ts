import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1AuditLogRepository } from "../../../src/infrastructure/db/D1AuditLogRepository";

describe("D1AuditLogRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  it("record()した内容をlistRecent()で新しい順に取得できる", async () => {
    const repo = new D1AuditLogRepository(ctx.db);
    await repo.record({
      actorId: null,
      actorName: "管理者太郎",
      action: "delete_import_batch",
      summary: "1件目",
      detail: { foo: 1 },
    });
    await new Promise((r) => setTimeout(r, 5));
    await repo.record({
      actorId: null,
      actorName: "管理者太郎",
      action: "delete_import_batch",
      summary: "2件目",
    });
    await repo.record({
      actorId: null,
      actorName: "管理者太郎",
      action: "other_action",
      summary: "対象外",
    });

    const rows = await repo.listRecent("delete_import_batch", 10);
    expect(rows.map((r) => r.summary)).toEqual(["2件目", "1件目"]);
    expect(rows[1]?.detail).toEqual({ foo: 1 });
    expect(rows[0]?.detail).toBeNull();
  });

  it("limitで件数を絞れる", async () => {
    const repo = new D1AuditLogRepository(ctx.db);
    for (let i = 0; i < 3; i++) {
      await repo.record({ actorId: null, actorName: "システム", action: "x", summary: `${i}` });
    }
    const rows = await repo.listRecent("x", 2);
    expect(rows).toHaveLength(2);
  });
});
