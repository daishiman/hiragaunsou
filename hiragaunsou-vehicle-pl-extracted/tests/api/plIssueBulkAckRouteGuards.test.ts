import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";

/**
 * まとめて判断を付ける/取り消すRoute Handler (/api/vehicle-pl/issue-ack/bulk) を検証する。
 *
 * 1件ずつの操作と違い、ここは一度に何十件もの指摘の扱いを決める。誤って通ると
 * 「見ていないのに問題なし」が大量に残るため、次の3つを固定する:
 *   - 閲覧のみのロール・他サイトからの呼び出しは通さない
 *   - 1件でも不正な対象が混ざっていたら全体を断る (通った分だけ処理しない)
 *   - 一度に処理できる上限を超えたら断る
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const inputSession: SessionUser = {
  id: "user-input",
  email: "staff@example.co.jp",
  name: "入力担当",
  role: "input_staff",
};

const { sessionRef } = vi.hoisted(() => ({
  sessionRef: { current: null as SessionUser | null },
}));
vi.mock("../../src/infrastructure/auth/session", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({
    env: { DB: {}, BETTER_AUTH_URL: ORIGIN },
  })),
}));

vi.mock("../../src/infrastructure/db/client", () => ({
  createDb: vi.fn(() => ({})),
}));

const { bulkAckMock, bulkUnackMock } = vi.hoisted(() => ({
  bulkAckMock: vi.fn(),
  bulkUnackMock: vi.fn(),
}));
vi.mock("../../src/usecase/steps/acknowledgePlIssue", () => ({
  BulkAcknowledgePlIssuesUseCase: class {
    execute = bulkAckMock;
  },
  BulkUnacknowledgePlIssuesUseCase: class {
    execute = bulkUnackMock;
  },
}));
vi.mock("../../src/infrastructure/db/D1AuditLogRepository", () => ({
  D1AuditLogRepository: class {},
}));

function post(body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/vehicle-pl/issue-ack/bulk/route").then(({ POST }) =>
    POST(
      new Request("http://test/api/vehicle-pl/issue-ack/bulk", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function del(body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/vehicle-pl/issue-ack/bulk/route").then(({ DELETE }) =>
    DELETE(
      new Request("http://test/api/vehicle-pl/issue-ack/bulk", {
        method: "DELETE",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

const target = { vehicleNo: "12", field: "fare", code: "anomaly", value: 900_000 };
const validBody = { yearMonth: "2026-05", targets: [target], reason: "同じ指摘" };

beforeEach(() => {
  sessionRef.current = inputSession;
  bulkAckMock.mockReset().mockResolvedValue({ count: 1 });
  bulkUnackMock.mockReset().mockResolvedValue({ count: 1 });
});

describe("POST /api/vehicle-pl/issue-ack/bulk", () => {
  it("未ログインなら401", async () => {
    sessionRef.current = null;
    expect((await post(validBody)).status).toBe(401);
    expect(bulkAckMock).not.toHaveBeenCalled();
  });

  it("閲覧のみのロールはまとめて処理できないので401", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    expect((await post(validBody)).status).toBe(401);
    expect(bulkAckMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    expect((await post(validBody, { origin: "https://evil.example.com" })).status).toBe(403);
    expect(bulkAckMock).not.toHaveBeenCalled();
  });

  it("対象が空なら400(何件処理したのか言えない実行をさせない)", async () => {
    expect((await post({ yearMonth: "2026-05", targets: [] })).status).toBe(400);
    expect(bulkAckMock).not.toHaveBeenCalled();
  });

  /**
   * 「通ったものだけ処理しました」にすると、まとめ操作では何が処理されたか分からなくなる。
   * 1件でも壊れていたら全体を断る。
   */
  it("1件でも知らない列名が混ざっていたら全体を断る", async () => {
    const res = await post({
      ...validBody,
      targets: [target, { ...target, field: "nonexistent" }],
    });
    expect(res.status).toBe(400);
    expect(bulkAckMock).not.toHaveBeenCalled();
  });

  it("1件でも知らない指摘の種類が混ざっていたら全体を断る", async () => {
    const res = await post({ ...validBody, targets: [target, { ...target, code: "whatever" }] });
    expect(res.status).toBe(400);
    expect(bulkAckMock).not.toHaveBeenCalled();
  });

  /** 誤クリックで一度に大量の指摘が通らないための歯止め。 */
  it("上限を超える件数は400として断る", async () => {
    const res = await post({
      ...validBody,
      targets: Array.from({ length: 201 }, (_, i) => ({ ...target, vehicleNo: String(i) })),
    });
    expect(res.status).toBe(400);
    expect(bulkAckMock).not.toHaveBeenCalled();
  });

  it("知らない判断の種類は400として弾く", async () => {
    expect((await post({ ...validBody, status: "maybe" })).status).toBe(400);
    expect(bulkAckMock).not.toHaveBeenCalled();
  });

  it("誰が通したかを監査できるようセッションの本人情報を渡す", async () => {
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect(bulkAckMock).toHaveBeenCalledWith(
      expect.objectContaining({
        yearMonth: "2026-05",
        status: "ok",
        reason: "同じ指摘",
        actorId: "user-input",
        actorName: "入力担当",
      }),
    );
    expect(await res.json()).toMatchObject({ count: 1, status: "ok" });
  });
});

describe("DELETE /api/vehicle-pl/issue-ack/bulk", () => {
  it("閲覧のみのロールは取り消せないので401", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    expect((await del(validBody)).status).toBe(401);
    expect(bulkUnackMock).not.toHaveBeenCalled();
  });

  /** 「元に戻す」が効かないと、まとめてOKを安心して押せない。 */
  it("まとめて付けた判断をまとめて取り消せる", async () => {
    const res = await del(validBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 1 });
  });
});
