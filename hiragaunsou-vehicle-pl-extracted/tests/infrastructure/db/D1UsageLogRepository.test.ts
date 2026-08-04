import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1UsageLogRepository } from "../../../src/infrastructure/db/D1UsageLogRepository";

/**
 * record/findSince の基本動作は tests/infrastructure/newD1Methods.test.ts で検証済みだが、
 * detail(JSON化)のundefined分岐・detailJsonがnullの復元分岐が未検証(branch 50%)だったため補う。
 */
describe("D1UsageLogRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  describe("record", () => {
    it("detailがundefinedのときはdetail_jsonをnullで保存する", async () => {
      const repo = new D1UsageLogRepository(ctx.db);
      await repo.record({
        kind: "pdf_ocr_extract",
        model: "claude-haiku-4-5",
        inputTokens: 10,
        outputTokens: 5,
        recordedBy: null,
        detail: undefined,
      });
      const row = ctx.sqlite.prepare("SELECT detail_json FROM usage_log").get() as { detail_json: string | null };
      expect(row.detail_json).toBeNull();
    });

    it("detailが指定されればJSON文字列化して保存する(nullも許容値としてJSON化する)", async () => {
      const repo = new D1UsageLogRepository(ctx.db);
      await repo.record({
        kind: "pdf_ocr_extract",
        model: "claude-haiku-4-5",
        inputTokens: 10,
        outputTokens: 5,
        recordedBy: null,
        detail: null,
      });
      const row = ctx.sqlite.prepare("SELECT detail_json FROM usage_log").get() as { detail_json: string | null };
      expect(row.detail_json).toBe("null");
    });
  });

  describe("findSince", () => {
    it("detail_jsonがnullの行はdetail:nullとして返す", async () => {
      const repo = new D1UsageLogRepository(ctx.db);
      await repo.record({
        kind: "pdf_ocr_extract",
        model: "claude-haiku-4-5",
        inputTokens: 10,
        outputTokens: 5,
        recordedBy: null,
        detail: undefined,
      });
      const rows = await repo.findSince(0);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.detail).toBeNull();
    });

    it("sinceMs以前のログは含めない(境界: createdAt未満は除外)", async () => {
      const repo = new D1UsageLogRepository(ctx.db);
      await repo.record({
        kind: "pdf_ocr_extract",
        model: "claude-haiku-4-5",
        inputTokens: 1,
        outputTokens: 1,
        recordedBy: null,
        detail: undefined,
      });
      const future = Date.now() + 60_000;
      expect(await repo.findSince(future)).toEqual([]);
    });
  });
});
