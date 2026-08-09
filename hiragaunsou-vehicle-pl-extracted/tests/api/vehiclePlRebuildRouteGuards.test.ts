import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * /api/vehicle-pl/rebuild (取込はあるのに収支表が無い月を作り直す) の防御と受け渡しを見る。
 *
 * 作り直しの中身は tests/lib/rebuildMonthlyPlAfterImport.test.ts で見ているので、
 * ここでは「閲覧だけの人には作らせない」「他所からのPOSTを受けない」「年月の形を確かめる」
 * 「結果をそのまま画面に返す」の4点に絞る。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const { sessionMock, rebuildMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  rebuildMock: vi.fn(async () => ({ status: "built", vehicleCount: 103 })),
}));

vi.mock("../../src/infrastructure/auth/session", () => ({ getServerSession: sessionMock }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({ env: { DB: {}, BETTER_AUTH_URL: ORIGIN } })),
}));

vi.mock("../../src/infrastructure/db/client", () => ({ createDb: vi.fn(() => ({})) }));

vi.mock("../../app/_lib/monthlyPlRecalculator", () => ({
  rebuildMonthlyPlAfterImport: rebuildMock,
}));

import { POST } from "../../app/api/vehicle-pl/rebuild/route";

function post(body: unknown, origin: string | null = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/vehicle-pl/rebuild`, {
    method: "POST",
    headers: origin ? { origin, "content-type": "application/json" } : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/vehicle-pl/rebuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rebuildMock.mockResolvedValue({ status: "built", vehicleCount: 103 });
    sessionMock.mockResolvedValue({ id: "u1", name: "管理者", role: "admin" });
  });

  it("入力権限が無い人は作り直せない", async () => {
    sessionMock.mockResolvedValue({ id: "u2", name: "役員", role: "executive" });
    const res = await POST(post({ yearMonth: "2026-05" }));
    expect(res.status).toBe(401);
    expect(rebuildMock).not.toHaveBeenCalled();
  });

  it("別サイトからのPOSTは受け付けない", async () => {
    const res = await POST(post({ yearMonth: "2026-05" }, "https://example.com"));
    expect(res.status).toBe(403);
    expect(rebuildMock).not.toHaveBeenCalled();
  });

  it("年月の形が違うときは、作り直しを走らせずに断る", async () => {
    const res = await POST(post({ yearMonth: "2026-13" }));
    expect(res.status).toBe(400);
    expect(rebuildMock).not.toHaveBeenCalled();
  });

  it("作った台数を対象月と一緒に返す", async () => {
    const res = await POST(post({ yearMonth: "2026-05" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ yearMonth: "2026-05", status: "built", vehicleCount: 103 });
    expect(rebuildMock).toHaveBeenCalledWith(expect.anything(), "2026-05");
  });

  it("車両マスタが空で作れなかった理由も、そのまま画面に渡す", async () => {
    // 画面はこの reason を見て「車両マスタを登録する」へ案内する。握り潰すと空の表に戻るだけになる。
    rebuildMock.mockResolvedValue({
      status: "skipped",
      reason: "no_vehicle_master",
    } as never);
    const res = await POST(post({ yearMonth: "2026-05" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      yearMonth: "2026-05",
      status: "skipped",
      reason: "no_vehicle_master",
    });
  });
});
