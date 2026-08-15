import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, withBatchShim } from "./testDbHelper";
import { D1InstructionTokenRepository } from "../../../src/infrastructure/db/D1InstructionTokenRepository";

/**
 * 指示文を読むための鍵の保管を、実際のマイグレーションを流した DB で確かめる。
 *
 * ここで見たいのは、アプリの分岐ではなく DB 側で守られていること。
 *   - 平文の鍵はどこにも入らない (入る欄が無い)
 *   - 同じ指紋の鍵を2つ作れない (unique)
 *   - 二重に失効させても、最初の時刻と理由が動かない
 *   - 要望を消したときに、その要望を含む鍵だけが止まる (全件の鍵は巻き添えにしない)
 */
describe("D1InstructionTokenRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  let repo: D1InstructionTokenRepository;

  const base = {
    createdById: null as unknown as string,
    createdByName: "管理者",
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  };

  async function issue(id: string, over: Record<string, unknown> = {}) {
    await repo.issue({
      ...base,
      id,
      name: `${id} の鍵`,
      tokenHash: `hash_${id}`,
      scopeIds: ["req_1"],
      ...over,
    });
  }

  beforeEach(() => {
    ctx = withBatchShim(createTestDb());
    repo = new D1InstructionTokenRepository(ctx.db);
  });

  it("保存されるのは指紋だけで、平文の鍵を入れる欄が無い", async () => {
    await issue("tok_1");
    const row = ctx.sqlite.prepare("select * from improvement_access_token").get() as Record<
      string,
      unknown
    >;
    expect(row.token_hash).toBe("hash_tok_1");
    expect(Object.keys(row)).not.toContain("token");
    expect(Object.values(row)).not.toContain("hgcc_");
  });

  it("同じ指紋の鍵は2つ作れない（アプリ側の判定に頼らない）", async () => {
    await issue("tok_1");
    await expect(issue("tok_2", { tokenHash: "hash_tok_1" })).rejects.toThrow();
  });

  it("指紋から引ける。知らない指紋では何も返らない", async () => {
    await issue("tok_1", { scopeIds: ["a", "b"] });
    const found = await repo.findByHash("hash_tok_1");
    expect(found).toMatchObject({ id: "tok_1", tokenHash: "hash_tok_1", scopeIds: ["a", "b"] });
    expect(await repo.findByHash("知らない指紋")).toBeNull();
  });

  it("一覧は新しい順で、失効済みも隠さずに出す", async () => {
    await issue("old", { tokenHash: "hash_old" });
    await new Promise((r) => setTimeout(r, 5));
    await issue("new", { tokenHash: "hash_new" });
    await repo.revoke("old", "渡す相手が変わったため");

    const list = await repo.list();
    expect(list.map((t) => t.id)).toEqual(["new", "old"]);
    expect(list[1]?.revokedReason).toBe("渡す相手が変わったため");
    expect(list[1]?.revokedAt).toBeInstanceOf(Date);
    // 一覧に平文が混ざらない (型だけでなく実際の値でも確かめる)。
    expect(list[0]).not.toHaveProperty("tokenHash");
  });

  it("二度失効させても、最初の時刻と理由のまま動かない", async () => {
    await issue("tok_1");
    expect(await repo.revoke("tok_1", "最初の理由")).toBe(true);
    const first = (await repo.list())[0];

    expect(await repo.revoke("tok_1", "あとから押した理由")).toBe(false);
    const after = (await repo.list())[0];
    expect(after?.revokedReason).toBe("最初の理由");
    expect(after?.revokedAt?.getTime()).toBe(first?.revokedAt?.getTime());
  });

  it("無い鍵を失効させても、falseを返すだけで落ちない", async () => {
    expect(await repo.revoke("知らない鍵", "理由")).toBe(false);
  });

  it("要望を消したときは、その要望を含む鍵だけを止める", async () => {
    await issue("scoped", { tokenHash: "h1", scopeIds: ["req_x", "req_y"] });
    await issue("other", { tokenHash: "h2", scopeIds: ["req_z"] });

    const stopped = await repo.revokeForRequests(["req_y"], "要望を完全に削除したため");
    expect(stopped).toEqual(["scoped の鍵"]);

    const list = await repo.list();
    expect(list.find((t) => t.id === "scoped")?.revokedAt).toBeInstanceOf(Date);
    expect(list.find((t) => t.id === "other")?.revokedAt).toBeNull();
  });

  it("発行済みのすべてを読める鍵は、1件消しただけでは止めない", async () => {
    await issue("all", { tokenHash: "h_all", scopeIds: [] });
    expect(await repo.revokeForRequests(["req_x"], "理由")).toEqual([]);
    expect((await repo.list())[0]?.revokedAt).toBeNull();
  });

  it("止める対象が無いとき・空の指定のときは何も書き換えない", async () => {
    await issue("tok_1", { scopeIds: ["req_1"] });
    expect(await repo.revokeForRequests([], "理由")).toEqual([]);
    expect(await repo.revokeForRequests(["別の要望"], "理由")).toEqual([]);
    expect((await repo.list())[0]?.revokedAt).toBeNull();
  });

  it("すでに止まっている鍵は、もう一度止める対象に数えない", async () => {
    await issue("tok_1", { scopeIds: ["req_1"] });
    await repo.revoke("tok_1", "先に止めた");
    expect(await repo.revokeForRequests(["req_1"], "要望を完全に削除したため")).toEqual([]);
    expect((await repo.list())[0]?.revokedReason).toBe("先に止めた");
  });

  it("名前が空の鍵は、記録にidを残す（何を止めたか分からなくならないように）", async () => {
    await issue("tok_1", { name: "", scopeIds: ["req_1"] });
    expect(await repo.revokeForRequests(["req_1"], "理由")).toEqual(["tok_1"]);
  });

  it("使われるたびに、最終使用時刻と回数が増える", async () => {
    await issue("tok_1");
    expect((await repo.list())[0]).toMatchObject({ useCount: 0, lastUsedAt: null });

    await repo.touch("tok_1");
    await repo.touch("tok_1");
    const after = (await repo.list())[0];
    expect(after?.useCount).toBe(2);
    expect(after?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("壊れた範囲が入っていても、一覧が開かなくならない", async () => {
    await issue("tok_1");
    ctx.sqlite.prepare("update improvement_access_token set scope_ids = '壊れている'").run();
    expect((await repo.list())[0]?.scopeIds).toEqual([]);
  });
});
