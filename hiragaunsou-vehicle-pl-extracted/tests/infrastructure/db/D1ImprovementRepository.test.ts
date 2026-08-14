import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import {
  D1ImprovementRepository,
  improvementRequestId,
} from "../../../src/infrastructure/db/D1ImprovementRepository";
import type { ImprovementSubmission } from "../../../src/domain/repositories/ImprovementRepository";

/**
 * better-sqlite3 のドライバに `.batch()` は無いので、渡された文を順に流すだけの
 * 代役を置く。全部戻る／戻らないは D1 側の保証なのでここでは再現していない。
 * このテストで確かめるのは「本文と画像が1件として揃うか」という結果の方。
 */
function createDb() {
  const ctx = createTestDb();
  ctx.db.batch = async (statements: PromiseLike<unknown>[]) => {
    const results: unknown[] = [];
    for (const stmt of statements) results.push(await stmt);
    return results;
  };
  return ctx;
}

const SHOT = "data:image/png;base64,iVBORw0KGgo=";

function submission(over: Partial<ImprovementSubmission> = {}): ImprovementSubmission {
  return {
    reporterId: null,
    reporterName: "山元",
    submissionKey: "0b7f6f1e-0000-4000-8000-000000000001",
    path: "/vehicle/1177",
    routePattern: "/vehicle/[vehicleNo]",
    screenLabel: "車両1台の明細",
    body: "合計が右端で切れています",
    viewport: "1280x800",
    userAgent: "test-agent",
    shot: null,
    shotBytes: 0,
    ...over,
  };
}

describe("improvementRequestId", () => {
  it("同じ投稿者と送信キーからは、いつも同じidになる", async () => {
    const a = await improvementRequestId("u1", "key-1");
    const b = await improvementRequestId("u1", "key-1");
    expect(a).toBe(b);
    expect(a).toMatch(/^improve_[0-9a-f]{24}$/);
  });

  it("投稿者が違えば別のidになる（他人の要望を上書きしない）", async () => {
    expect(await improvementRequestId("u1", "key-1")).not.toBe(
      await improvementRequestId("u2", "key-1"),
    );
  });
});

describe("D1ImprovementRepository", () => {
  let ctx: ReturnType<typeof createDb>;
  beforeEach(() => {
    ctx = createDb();
  });

  describe("save", () => {
    it("画像なしの要望を保存し、一覧に「画像なし」で出す", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());

      const list = await repo.listAll();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id,
        status: "open",
        path: "/vehicle/1177",
        routePattern: "/vehicle/[vehicleNo]",
        screenLabel: "車両1台の明細",
        reporterName: "山元",
        hasShot: false,
      });
    });

    it("画像ありなら、本文と画像が1件として揃う", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission({ shot: SHOT, shotBytes: 1234 }));

      const list = await repo.listAll();
      expect(list[0]?.hasShot).toBe(true);
      const detail = await repo.findById(id);
      expect(detail?.shot).toBe(SHOT);
    });

    it("同じ送信キーで送り直しても2件にならず、先に入った内容が残る", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const first = await repo.save(submission({ reporterId: null, body: "最初の文章" }));
      const second = await repo.save(
        submission({ reporterId: null, body: "押し直したときの文章", shot: SHOT, shotBytes: 10 }),
      );

      expect(second).toBe(first);
      const list = await repo.listAll();
      expect(list).toHaveLength(1);
      expect(list[0]?.body).toBe("最初の文章");
    });

    it("送信キーが違えば別件として並ぶ", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      await repo.save(submission({ submissionKey: "key-a" }));
      await repo.save(submission({ submissionKey: "key-b" }));
      expect(await repo.listAll()).toHaveLength(2);
    });
  });

  describe("findBySubmissionKey", () => {
    it("未送信の鍵にはnullを返す", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      expect(await repo.findBySubmissionKey("u1", "key-none")).toBeNull();
    });

    it("送信済みの鍵からは、その要望のidを引ける", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      ctx.sqlite
        .prepare(`INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, 1)`)
        .run("u1", "山元", "yamamoto@example.com");
      const id = await repo.save(submission({ reporterId: "u1", submissionKey: "key-1" }));
      expect(await repo.findBySubmissionKey("u1", "key-1")).toBe(id);
      // 別人が同じ鍵を持っていても、他人の要望は引けない
      expect(await repo.findBySubmissionKey("u2", "key-1")).toBeNull();
    });
  });

  describe("findById", () => {
    it("無いidにはnullを返す", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      expect(await repo.findById("improve_none")).toBeNull();
    });

    it("再現の手がかり（画面の広さ・ブラウザ）まで返す", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      const detail = await repo.findById(id);
      expect(detail).toMatchObject({
        viewport: "1280x800",
        userAgent: "test-agent",
        hasShot: false,
        shot: null,
        handledByName: null,
        handledAt: null,
      });
    });
  });

  describe("updateHandling", () => {
    beforeEach(() => {
      ctx.sqlite
        .prepare(`INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, 1)`)
        .run("admin-1", "今西", "imanishi@example.com");
    });

    it("対応状況とメモを更新し、誰が対応したかを残す", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());

      await repo.updateHandling(id, {
        status: "dropped",
        note: "別の画面で直したため",
        handledById: "admin-1",
      });

      const detail = await repo.findById(id);
      expect(detail?.status).toBe("dropped");
      expect(detail?.handledNote).toBe("別の画面で直したため");
      expect(detail?.handledByName).toBe("今西");
      expect(detail?.handledAt).toBeInstanceOf(Date);
      // 一覧でもメモが見える (開かないと分からない状態にしない)
      expect((await repo.listAll())[0]?.handledNote).toBe("別の画面で直したため");
    });

    it("同じ状況のままメモだけ消せる", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      await repo.updateHandling(id, { status: "done", note: "直した", handledById: "admin-1" });
      await repo.updateHandling(id, { status: "done", note: null, handledById: "admin-1" });
      expect((await repo.findById(id))?.handledNote).toBeNull();
    });

    it("対応済みから未対応へ戻せる（終端にしない）", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      await repo.updateHandling(id, { status: "done", note: null, handledById: "admin-1" });
      await repo.updateHandling(id, { status: "open", note: null, handledById: "admin-1" });
      expect((await repo.findById(id))?.status).toBe("open");
    });
  });

  describe("保存されている状況が想定外のとき", () => {
    it("知らない状況の文字列は、そもそもDBが受け付けない", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      expect(() =>
        ctx.sqlite.prepare(`UPDATE improvement_request SET status = 'unknown' WHERE id = ?`).run(id),
      ).toThrow(/CHECK constraint failed/);
      // 読み出し側の既定値も「未対応」。表に無い状況が入り込んでも画面は壊れない。
      expect((await repo.findById(id))?.status).toBe("open");
    });
  });
});
