import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";

/**
 * /api/confirm (STEP8 月次収支表の確定/確定解除) のRoute Handlerを検証する。
 *
 * 締めの操作なので入力権限とCSRF防御が要る。加えて confirmed が boolean でないと
 * 「確定を外すつもりが確定してしまう」事故になるため、型そのものの検証も分岐として持っている。
 * ConfirmMonthlyPlUseCase は実物を使い、リポジトリだけ差し替えて
 * 「行が無い月は確定できない」という業務ルールが500として表に出ることまで通しで確かめる。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const adminSession: SessionUser = {
  id: "user-admin",
  email: "imanishi@example.co.jp",
  name: "今西",
  role: "admin",
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

const { getConfirmationMock, setConfirmedMock } = vi.hoisted(() => ({
  getConfirmationMock: vi.fn(),
  setConfirmedMock: vi.fn(),
}));
vi.mock("../../src/infrastructure/db/D1VehiclePlRepository", () => ({
  D1VehiclePlRepository: class {
    getConfirmation = getConfirmationMock;
    setConfirmed = setConfirmedMock;
  },
}));

const { findOpenByYearMonthMock } = vi.hoisted(() => ({ findOpenByYearMonthMock: vi.fn() }));
vi.mock("../../src/infrastructure/db/D1ReviewFlagRepository", () => ({
  D1ReviewFlagRepository: class {
    findOpenByYearMonth = findOpenByYearMonthMock;
  },
}));

function postConfirm(body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/confirm/route").then(({ POST }) =>
    POST(
      new Request("http://test/api/confirm", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

beforeEach(() => {
  sessionRef.current = adminSession;
  getConfirmationMock.mockReset().mockResolvedValue({ total: 0, confirmed: 0 });
  setConfirmedMock.mockReset().mockResolvedValue(undefined);
  findOpenByYearMonthMock.mockReset().mockResolvedValue([]);
});

describe("POST /api/confirm のガード", () => {
  it("未ログインなら401(Cloudflare bindingに触れない)", async () => {
    sessionRef.current = null;
    const res = await postConfirm({ yearMonth: "2026-05", confirmed: true });
    expect(res.status).toBe(401);
    expect(setConfirmedMock).not.toHaveBeenCalled();
  });

  it("閲覧のみの社長ロールは締められないので401", async () => {
    sessionRef.current = { id: "user-exec", email: "exec@example.co.jp", name: "社長", role: "executive" };
    const res = await postConfirm({ yearMonth: "2026-05", confirmed: true });
    expect(res.status).toBe(401);
    expect(setConfirmedMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const res = await postConfirm({ yearMonth: "2026-05", confirmed: true }, {
      origin: "https://evil.example.com",
    });
    expect(res.status).toBe(403);
    expect(setConfirmedMock).not.toHaveBeenCalled();
  });

  it("Originヘッダーが無ければ403", async () => {
    const res = await postConfirm({ yearMonth: "2026-05", confirmed: true }, {});
    expect(res.status).toBe(403);
  });
});

describe("POST /api/confirm の入力検証", () => {
  it("yearMonthが無ければ400", async () => {
    const res = await postConfirm({ confirmed: true });
    expect(res.status).toBe(400);
  });

  it("confirmedが未指定なら400(既定値で締めない)", async () => {
    const res = await postConfirm({ yearMonth: "2026-05" });
    expect(res.status).toBe(400);
    expect(setConfirmedMock).not.toHaveBeenCalled();
  });

  it('confirmedが文字列"true"なら400(真偽値以外を受け付けない)', async () => {
    const res = await postConfirm({ yearMonth: "2026-05", confirmed: "true" });
    expect(res.status).toBe(400);
    expect(setConfirmedMock).not.toHaveBeenCalled();
  });

  it("JSONとして壊れているbodyは400", async () => {
    const { POST } = await import("../../app/api/confirm/route");
    const res = await POST(
      new Request("http://test/api/confirm", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/confirm の正常系と業務ルール", () => {
  it("全行を確定すると isConfirmed=true の状態を返す", async () => {
    getConfirmationMock
      .mockResolvedValueOnce({ total: 12, confirmed: 0 }) // 確定前の canConfirm 判定
      .mockResolvedValue({ total: 12, confirmed: 12 }); // 確定後の状態
    findOpenByYearMonthMock.mockResolvedValue([
      { id: "f1", vehicleNo: "4242", field: "fuelIn", type: "spike", severity: "warning", message: "前月比+180%", status: "open" },
    ]);

    const res = await postConfirm({ yearMonth: "2026-05", confirmed: true });
    expect(res.status).toBe(200);
    expect(setConfirmedMock).toHaveBeenCalledWith("2026-05", true);

    const body = (await res.json()) as {
      total: number;
      confirmedCount: number;
      isConfirmed: boolean;
      openFlagCount: number;
      canConfirm: boolean;
    };
    expect(body).toMatchObject({
      total: 12,
      confirmedCount: 12,
      isConfirmed: true,
      canConfirm: true,
    });
    // 未判定の異常値が残っていても確定自体は通す(画面で注意を出すための件数)
    expect(body.openFlagCount).toBe(1);
  });

  it("収支表が1行も無い月を確定しようとすると500(締められる状態にない)", async () => {
    getConfirmationMock.mockResolvedValue({ total: 0, confirmed: 0 });
    const res = await postConfirm({ yearMonth: "2026-05", confirmed: true });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("まだ収支表がありません");
    expect(setConfirmedMock).not.toHaveBeenCalled();
  });

  it("確定解除は行が無くても素通しする(状態を戻すだけのため)", async () => {
    getConfirmationMock.mockResolvedValue({ total: 0, confirmed: 0 });
    const res = await postConfirm({ yearMonth: "2026-05", confirmed: false });
    expect(res.status).toBe(200);
    expect(setConfirmedMock).toHaveBeenCalledWith("2026-05", false);
    const body = (await res.json()) as { isConfirmed: boolean; canConfirm: boolean };
    // 0行のときは total>0 でないので isConfirmed は立たない
    expect(body.isConfirmed).toBe(false);
    expect(body.canConfirm).toBe(false);
  });

  it("D1が落ちたら500で例外のメッセージを返す", async () => {
    getConfirmationMock.mockRejectedValue(new Error("D1_ERROR: database is locked"));
    const res = await postConfirm({ yearMonth: "2026-05", confirmed: true });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({
      error: "D1_ERROR: database is locked",
    });
  });

  it("Error以外がthrowされても500で既定メッセージを返す", async () => {
    getConfirmationMock.mockRejectedValue({ code: 500 });
    const res = await postConfirm({ yearMonth: "2026-05", confirmed: true });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: "確定できませんでした" });
  });
});
