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
    diagnostics: null,
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

    it("診断情報は本文と一緒に入り、詳細で読み出せる", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const diagnostics = {
        version: 1,
        environment: { browser: "Chrome 141" },
        errors: [{ kind: "uncaught", message: "boom" }],
      } as never;
      const id = await repo.save(submission({ diagnostics }));
      expect(await repo.findById(id)).toMatchObject({
        diagnostics: { environment: { browser: "Chrome 141" } },
      });
    });

    it("診断情報が壊れていても、要望そのものは開ける", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      ctx.sqlite
        .prepare(`INSERT INTO improvement_diagnostics (request_id, payload, bytes) VALUES (?,?,?)`)
        .run(id, "{壊れたJSON", 10);
      const detail = await repo.findById(id);
      expect(detail?.diagnostics).toBeNull();
      expect(detail?.body).toBe("合計が右端で切れています");
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

  /**
   * 1つの要望に指示文は1つ。
   *
   * 二重に発行されると、Claude Code が同じ改善を2回やることになる。防ぎ方は3段で、
   * ここで確かめるのは下の2段 (保存の側)。
   *   - 発行の権利を1人だけが取る (リース)
   *   - improvement_instruction の主キーが request_id なので、そもそも2行にならない
   */
  describe("指示文の発行", () => {
    beforeEach(() => {
      const insert = ctx.sqlite.prepare(
        `INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, 1)`,
      );
      insert.run("admin-1", "今西", "imanishi@example.com");
      insert.run("admin-2", "山田", "yamada@example.com");
    });

    const published = (version: number, hash: string, by = "admin-1") => ({
      version,
      hash,
      syncedFields: null,
      publishedById: by,
    });

    /**
     * 実際の発行と同じ順で1版出す。
     * 権利を取らずに書き込む道は用意していない (取らずに書けると二重発行が通る)。
     */
    async function publish(
      repo: D1ImprovementRepository,
      id: string,
      version: number,
      hash: string,
      by = "admin-1",
    ) {
      await repo.beginPublishing(id, 60_000);
      return repo.markPublished(id, published(version, hash, by));
    }

    it("発行の権利は1人しか取れない", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      expect(await repo.beginPublishing(id, 60_000)).toBe(true);
      expect(await repo.beginPublishing(id, 60_000)).toBe(false);
    });

    it("取りかかったまま落ちても、時間が経てば次の人が試せる", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      expect(await repo.beginPublishing(id, 60_000)).toBe(true);
      // 権利を持てる時間を 0 にすると、直前に取った印も古いものとして扱われる。
      expect(await repo.beginPublishing(id, 0)).toBe(true);
    });

    it("失敗して権利を返せば、すぐ次を試せる", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      await repo.beginPublishing(id, 60_000);
      await repo.releasePublishing(id);
      expect(await repo.beginPublishing(id, 60_000)).toBe(true);
    });

    it("発行し終えたら権利は返り、次の版を出せる", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      await repo.beginPublishing(id, 60_000);
      expect(await repo.markPublished(id, published(1, "指紋1"))).toBe(true);
      expect(await repo.beginPublishing(id, 60_000)).toBe(true);
      expect(await repo.markPublished(id, published(2, "指紋2", "admin-2"))).toBe(true);
      expect((await repo.findById(id))?.instruction).toMatchObject({
        version: 2,
        hash: "指紋2",
        state: "published",
      });
    });

    it("古い版が、あとから新しい版を踏み潰さない", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      await publish(repo, id, 1, "指紋1");
      await publish(repo, id, 2, "指紋2");
      // 遅れて届いた v2 は、すでに v2 がある以上もう一度は通さない。
      expect(await publish(repo, id, 2, "遅れて届いた", "admin-2")).toBe(false);
      expect((await repo.findById(id))?.instruction).toMatchObject({ version: 2, hash: "指紋2" });
    });

    it("何度発行しても、指示文の行は1件しか作られない", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      await publish(repo, id, 1, "指紋1");
      await publish(repo, id, 2, "指紋2");
      await publish(repo, id, 3, "指紋3");
      const n = ctx.sqlite
        .prepare(`SELECT count(*) AS n FROM improvement_instruction WHERE request_id = ?`)
        .get(id) as { n: number };
      expect(n.n).toBe(1);
    });

    it("読み込まれたことを控えると、状態と回数が進む", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      await publish(repo, id, 1, "指紋1");

      await repo.markFetched([id]);
      expect((await repo.findById(id))?.instruction).toMatchObject({ state: "fetched" });
      const first = ctx.sqlite
        .prepare(`SELECT fetch_count AS c FROM improvement_instruction WHERE request_id = ?`)
        .get(id) as { c: number };
      expect(first.c).toBe(1);

      await repo.markFetched([id]);
      const second = ctx.sqlite
        .prepare(`SELECT fetch_count AS c FROM improvement_instruction WHERE request_id = ?`)
        .get(id) as { c: number };
      expect(second.c).toBe(2);
    });

    it("取り下げた指示文は、読み込まれたことにならない", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      await publish(repo, id, 1, "指紋1");
      await repo.withdrawInstruction(id);

      await repo.markFetched([id]);

      // 取り下げたものが、読まれた拍子に生き返ってはいけない。
      expect((await repo.findById(id))?.instruction).toMatchObject({ state: "withdrawn" });
    });

    it("一覧にも発行済みかどうかが出る", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      expect((await repo.listAll())[0]?.instruction).toBeNull();
      await publish(repo, id, 1, "指紋1");
      expect((await repo.listAll())[0]?.instruction).toMatchObject({ version: 1 });
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

  describe("しまう・戻す・完全に削除する", () => {
    beforeEach(() => {
      ctx.sqlite
        .prepare(`INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, 1)`)
        .run("admin-1", "今西", "imanishi@example.com");
    });

    it("廃棄すると既定の一覧から外れ、戻せばまた並ぶ", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());

      await repo.updateLifecycle(id, { archivedAt: new Date(), actorId: "admin-1" });
      expect((await repo.listAll())[0]?.archivedAt).toBeInstanceOf(Date);

      await repo.updateLifecycle(id, { archivedAt: null, actorId: "admin-1" });
      expect((await repo.listAll())[0]?.archivedAt).toBeNull();
    });

    it("完全削除では、本文だけでなく画像と診断情報も一緒に消える", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(
        submission({
          shot: SHOT,
          shotBytes: 1234,
          diagnostics: { version: 1, environment: { browser: "Chrome 141" } } as never,
        }),
      );
      expect((await repo.findById(id))?.shot).toBe(SHOT);

      await repo.purge([id]);

      expect(await repo.findById(id)).toBeNull();
      // 画像と診断情報が残っていると、消したつもりの個人情報が残る。
      const shots = ctx.sqlite
        .prepare(`SELECT count(*) AS n FROM improvement_shot WHERE request_id = ?`)
        .get(id) as { n: number };
      const diags = ctx.sqlite
        .prepare(`SELECT count(*) AS n FROM improvement_diagnostics WHERE request_id = ?`)
        .get(id) as { n: number };
      expect(shots.n).toBe(0);
      expect(diags.n).toBe(0);
    });

    it("完全削除では、発行済みの指示文も一緒に消える", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      await repo.beginPublishing(id, 60_000);
      await repo.markPublished(id, {
        version: 1,
        hash: "指紋1",
        syncedFields: null,
        publishedById: "admin-1",
      });

      await repo.purge([id]);

      // 指示文が残っていると、消したはずの本文が読み直されて組み立てられる。
      const n = ctx.sqlite
        .prepare(`SELECT count(*) AS n FROM improvement_instruction WHERE request_id = ?`)
        .get(id) as { n: number };
      expect(n.n).toBe(0);
    });

    it("完全削除しても、いつ誰がなぜ消したかの記録は残る", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(submission());
      await repo.appendAudit([
        {
          requestId: id,
          actorId: "admin-1",
          actorName: "今西",
          action: "purge",
          fromStatus: "open",
          toStatus: null,
          reason: "本人から削除の依頼があったため",
        },
      ]);

      await repo.purge([id]);

      const audit = await repo.auditOf(id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "purge", reason: "本人から削除の依頼があったため" });
    });

    it("まとめ先を完全削除しても、まとめられた側は開ける", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const parent = await repo.save(submission({ submissionKey: "key-parent" }));
      const child = await repo.save(submission({ submissionKey: "key-child" }));
      await repo.updateLifecycle(child, {
        status: "duplicate",
        note: "同じ話のため",
        duplicateOfId: parent,
        actorId: "admin-1",
      });
      expect((await repo.findById(child))?.duplicateOfId).toBe(parent);

      await repo.purge([parent]);

      const detail = await repo.findById(child);
      expect(detail).not.toBeNull();
      // 行き先が消えたリンクは残さない (開いても無い先へ飛ばさない)。
      expect(detail?.duplicateOfId).toBeNull();
    });
  });

  /**
   * 保存期間を過ぎた写し・診断情報の掃除。
   *
   * 画面の写しには、映り込んだ数字も名前もそのまま残る。持ち続ける理由が無くなった
   * 分から落としていくが、本文と記録まで消すと「何を直すと決めたか」が失われる。
   * ここで固定するのは「重い方だけが消え、判断の跡は残る」こと。
   */
  describe("保存期間を過ぎた写し・診断情報の掃除", () => {
    /** その要望の写し・診断情報を、指定の時刻に届いたことにする。 */
    function ageAttachments(id: string, at: Date) {
      for (const table of ["improvement_shot", "improvement_diagnostics"]) {
        ctx.sqlite
          .prepare(`UPDATE ${table} SET created_at = ? WHERE request_id = ?`)
          .run(at.getTime(), id);
      }
    }

    function withAttachments(over: Partial<ImprovementSubmission> = {}) {
      return submission({
        shot: SHOT,
        shotBytes: 1234,
        diagnostics: { version: 1, environment: { browser: "Chrome 141" } } as never,
        ...over,
      });
    }

    const CUTOFF = new Date("2026-08-15T00:00:00.000Z");

    it("境目より前の写しと診断情報は、揃って消える", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(withAttachments());
      ageAttachments(id, new Date("2026-05-01T00:00:00.000Z"));

      const swept = await repo.sweepExpiredAttachments(CUTOFF, 100);

      expect(swept.requestIds).toEqual([id]);
      expect(swept.shots).toBe(1);
      expect(swept.diagnostics).toBe(1);
      // 片方だけ残ると、消したつもりの手がかりが残る。
      expect((await repo.findById(id))?.shot).toBeNull();
      expect((await repo.findById(id))?.diagnostics).toBeNull();
    });

    it("消えるのは重い方だけで、本文と記録は残る", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(withAttachments());
      ageAttachments(id, new Date("2026-05-01T00:00:00.000Z"));

      await repo.sweepExpiredAttachments(CUTOFF, 100);

      const detail = await repo.findById(id);
      expect(detail).not.toBeNull();
      expect(detail?.body).toBe("合計が右端で切れています");
    });

    it("境目より後に届いた分は消さない", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const id = await repo.save(withAttachments());
      ageAttachments(id, new Date("2026-08-14T23:59:59.000Z"));

      const swept = await repo.sweepExpiredAttachments(
        new Date("2026-08-14T00:00:00.000Z"),
        100,
      );

      expect(swept.requestIds).toEqual([]);
      expect((await repo.findById(id))?.shot).toBe(SHOT);
    });

    it("1回に消す件数には上限があり、残りは次の回に持ち越す", async () => {
      const repo = new D1ImprovementRepository(ctx.db);
      const ids = [];
      for (const key of ["key-1", "key-2", "key-3"]) {
        const id = await repo.save(withAttachments({ submissionKey: key }));
        ageAttachments(id, new Date("2026-05-01T00:00:00.000Z"));
        ids.push(id);
      }

      const first = await repo.sweepExpiredAttachments(CUTOFF, 2);
      expect(first.requestIds).toHaveLength(2);

      const second = await repo.sweepExpiredAttachments(CUTOFF, 2);
      expect(second.requestIds).toHaveLength(1);
      // 3件とも、いずれかの回で消えている。
      expect([...first.requestIds, ...second.requestIds].sort()).toEqual([...ids].sort());
    });
  });
});
