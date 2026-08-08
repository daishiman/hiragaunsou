import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";

/**
 * 収支表の指摘をさばく2つのRoute Handlerを検証する。
 *   - /api/vehicle-pl/issue-ack  … 指摘を「確認しました。このままでよい」にする / 取り消す
 *   - /api/vehicle-pl/apply      … 溜まっている直しを収支表へまとめて反映する
 *
 * どちらも収支表の見え方と数字を変えるので、閲覧のみのロールに触らせない。
 * 加えて issue-ack は、指摘がDBに無く導出されるため「知らない列名・知らない指摘の種類」を
 * そのまま保存すると、二度と画面に現れない印が溜まり続ける。ここで弾くことを固定する。
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

const { ackExecuteMock, unackExecuteMock, applyExecuteMock } = vi.hoisted(() => ({
  ackExecuteMock: vi.fn(),
  unackExecuteMock: vi.fn(),
  applyExecuteMock: vi.fn(),
}));
vi.mock("../../src/usecase/steps/acknowledgePlIssue", () => ({
  AcknowledgePlIssueUseCase: class {
    execute = ackExecuteMock;
  },
  UnacknowledgePlIssueUseCase: class {
    execute = unackExecuteMock;
  },
}));
vi.mock("../../src/usecase/steps/applyPendingOverrides", () => ({
  ApplyPendingOverridesUseCase: class {
    execute = applyExecuteMock;
  },
}));

// D1に触れる実体は差し替える (D1が無い環境でルートを組み立てられるようにするため)。
vi.mock("../../src/infrastructure/db/D1PlIssueAckRepository", () => ({
  D1PlIssueAckRepository: class {},
}));
vi.mock("../../src/infrastructure/db/D1VehiclePlOverrideRepository", () => ({
  D1VehiclePlOverrideRepository: class {},
}));
vi.mock("../../src/infrastructure/db/D1AuditLogRepository", () => ({
  D1AuditLogRepository: class {},
}));
vi.mock("../../app/_lib/monthlyPlRecalculator", () => ({
  monthlyPlRecalculator: vi.fn(() => ({ execute: vi.fn() })),
}));

function ack(body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/vehicle-pl/issue-ack/route").then(({ POST }) =>
    POST(
      new Request("http://test/api/vehicle-pl/issue-ack", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function unack(query: string, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/vehicle-pl/issue-ack/route").then(({ DELETE }) =>
    DELETE(
      new Request(`http://test/api/vehicle-pl/issue-ack${query}`, { method: "DELETE", headers }),
    ),
  );
}

function apply(body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/vehicle-pl/apply/route").then(({ POST }) =>
    POST(
      new Request("http://test/api/vehicle-pl/apply", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

const validKey = { yearMonth: "2026-05", vehicleNo: "12", field: "fare", code: "anomaly" };
const validQuery = "?yearMonth=2026-05&vehicleNo=12&field=fare&code=anomaly";

beforeEach(() => {
  sessionRef.current = inputSession;
  ackExecuteMock.mockReset().mockResolvedValue(undefined);
  unackExecuteMock.mockReset().mockResolvedValue(undefined);
  applyExecuteMock
    .mockReset()
    .mockResolvedValue({ yearMonth: "2026-05", appliedCount: 3, vehicleCount: 106, pendingCount: 0 });
});

describe("POST /api/vehicle-pl/issue-ack", () => {
  it("未ログインなら401", async () => {
    sessionRef.current = null;
    expect((await ack(validKey)).status).toBe(401);
    expect(ackExecuteMock).not.toHaveBeenCalled();
  });

  it("閲覧のみのロールは確認済みにできないので401", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    expect((await ack(validKey)).status).toBe(401);
    expect(ackExecuteMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const res = await ack(validKey, { origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(ackExecuteMock).not.toHaveBeenCalled();
  });

  it("キーが1つでも欠けていれば400", async () => {
    expect((await ack({ ...validKey, field: undefined })).status).toBe(400);
    expect((await ack({ ...validKey, vehicleNo: undefined })).status).toBe(400);
    expect(ackExecuteMock).not.toHaveBeenCalled();
  });

  /** 収支表に無い列を通すと、どの画面にも現れない印が残り続ける。 */
  it("収支表に無い列は400として弾く", async () => {
    const res = await ack({ ...validKey, field: "nonexistent" });
    expect(res.status).toBe(400);
    expect(ackExecuteMock).not.toHaveBeenCalled();
  });

  it("知らない指摘の種類は400として弾く", async () => {
    const res = await ack({ ...validKey, code: "whatever" });
    expect(res.status).toBe(400);
    expect(ackExecuteMock).not.toHaveBeenCalled();
  });

  it("誰が通したかを監査できるようセッションの本人情報を渡す", async () => {
    const res = await ack({ ...validKey, note: "臨時便のため" });
    expect(res.status).toBe(200);
    expect(ackExecuteMock).toHaveBeenCalledWith({
      ...validKey,
      note: "臨時便のため",
      actorId: "user-input",
      actorName: "入力担当",
    });
    expect(await res.json()).toMatchObject({ acknowledged: true, ackedByName: "入力担当" });
  });
});

describe("DELETE /api/vehicle-pl/issue-ack", () => {
  it("閲覧のみのロールは取り消せないので401", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    expect((await unack(validQuery)).status).toBe(401);
    expect(unackExecuteMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const res = await unack(validQuery, { origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(unackExecuteMock).not.toHaveBeenCalled();
  });

  it("確認済みを取り消すと、その指摘はまた確認対象に戻る", async () => {
    const res = await unack(validQuery);
    expect(res.status).toBe(200);
    expect(unackExecuteMock).toHaveBeenCalledWith({
      ...validKey,
      actorId: "user-input",
      actorName: "入力担当",
    });
    expect(await res.json()).toMatchObject({ acknowledged: false });
  });
});

describe("POST /api/vehicle-pl/apply", () => {
  it("閲覧のみのロールは反映できないので401", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    expect((await apply({ yearMonth: "2026-05" })).status).toBe(401);
    expect(applyExecuteMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const res = await apply({ yearMonth: "2026-05" }, { origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(applyExecuteMock).not.toHaveBeenCalled();
  });

  it("yearMonth が無ければ400", async () => {
    expect((await apply({})).status).toBe(400);
    expect(applyExecuteMock).not.toHaveBeenCalled();
  });

  /** 画面は返ってきた件数をそのまま「◯件を反映しました」と出す。 */
  it("反映した件数と作り直した台数を返す", async () => {
    const res = await apply({ yearMonth: "2026-05" });
    expect(res.status).toBe(200);
    expect(applyExecuteMock).toHaveBeenCalledWith({
      yearMonth: "2026-05",
      actorId: "user-input",
      actorName: "入力担当",
    });
    expect(await res.json()).toMatchObject({ appliedCount: 3, vehicleCount: 106 });
  });

  it("反映に失敗したら理由を400として返す", async () => {
    applyExecuteMock.mockRejectedValue(new Error("この月のデータがありません"));
    const res = await apply({ yearMonth: "2026-05" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "この月のデータがありません" });
  });
});
