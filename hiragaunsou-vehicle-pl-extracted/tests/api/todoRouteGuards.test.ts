import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";

/**
 * GET /api/todo (F2 今月のToDoボード) のガードと配線を検証する。
 * 未ログイン401は tests/api/routeAuthGuards.test.ts で網羅済みのため、
 * ここでは「権限不足」「バリデーション」「UseCaseへのyearMonth受け渡しと応答形状」を扱う。
 *
 * UseCase はモックせずリポジトリだけモックする。route が UseCase を内部で new する構造のため、
 * 実 UseCase を通した方が yearMonth の受け渡しと整形結果を同時に検証できる。
 */
const { sessionRef, findOpenByYearMonthMock } = vi.hoisted(() => ({
  sessionRef: { current: null as SessionUser | null },
  findOpenByYearMonthMock: vi.fn(),
}));

vi.mock("../../src/infrastructure/auth/session", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({ env: { DB: {} } })),
}));

vi.mock("../../src/infrastructure/db/client", () => ({
  createDb: vi.fn(() => ({})),
}));

vi.mock("../../src/infrastructure/db/D1ReviewFlagRepository", () => ({
  D1ReviewFlagRepository: class {
    findOpenByYearMonth = findOpenByYearMonthMock;
  },
}));

function flag(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "flag-1",
    vehicleNo: "2",
    field: "fuelCost",
    type: "spike",
    severity: "warning",
    message: "燃料費が平常月の2倍です",
    status: "open",
    ...overrides,
  };
}

async function getTodo(url: string) {
  const { GET } = await import("../../app/api/todo/route");
  return GET(new Request(url));
}

describe("GET /api/todo", () => {
  beforeEach(() => {
    sessionRef.current = {
      id: "user-1",
      email: "staff@example.co.jp",
      name: "山本",
      role: "input_staff",
    };
    findOpenByYearMonthMock.mockReset();
    findOpenByYearMonthMock.mockResolvedValue([]);
  });

  it("view権限を持たないロールは401 (未知ロールは fail-closed)", async () => {
    sessionRef.current = {
      id: "user-x",
      email: "guest@example.co.jp",
      name: "ゲスト",
      role: "guest",
    };
    const res = await getTodo("http://test/api/todo?yearMonth=2026-05");
    expect(res.status).toBe(401);
    // 権限で弾かれた時点でDBには一切触れない
    expect(findOpenByYearMonthMock).not.toHaveBeenCalled();
  });

  it("executive(閲覧のみのロール)はview権限を持つので200", async () => {
    sessionRef.current = {
      id: "user-2",
      email: "exec@example.co.jp",
      name: "社長",
      role: "executive",
    };
    const res = await getTodo("http://test/api/todo?yearMonth=2026-05");
    expect(res.status).toBe(200);
  });

  it("yearMonth が無ければ400", async () => {
    const res = await getTodo("http://test/api/todo");
    expect(res.status).toBe(400);
    expect(findOpenByYearMonthMock).not.toHaveBeenCalled();
  });

  it("yearMonth が空文字なら400 (空クエリを有効値として扱わない)", async () => {
    const res = await getTodo("http://test/api/todo?yearMonth=");
    expect(res.status).toBe(400);
  });

  it("リクエストの yearMonth をそのままリポジトリへ渡し、重大度順のカードを返す", async () => {
    findOpenByYearMonthMock.mockResolvedValue([
      flag({ id: "f-info", severity: "info" }),
      flag({ id: "f-critical", severity: "critical" }),
      flag({ id: "f-warning", severity: "warning" }),
    ]);

    const res = await getTodo("http://test/api/todo?yearMonth=2026-05");
    expect(res.status).toBe(200);
    expect(findOpenByYearMonthMock).toHaveBeenCalledWith("2026-05");

    const body = (await res.json()) as {
      yearMonth: string;
      totalOpen: number;
      cards: { id: string }[];
      emptyMessage: string | null;
    };
    expect(body.yearMonth).toBe("2026-05");
    expect(body.totalOpen).toBe(3);
    expect(body.cards.map((c) => c.id)).toEqual(["f-critical", "f-warning", "f-info"]);
    expect(body.emptyMessage).toBeNull();
  });

  it("openフラグが空なら totalOpen=0 と完了メッセージを返す(境界値)", async () => {
    findOpenByYearMonthMock.mockResolvedValue([]);
    const res = await getTodo("http://test/api/todo?yearMonth=2026-06");

    const body = (await res.json()) as {
      totalOpen: number;
      cards: unknown[];
      emptyMessage: string | null;
    };
    expect(body.totalOpen).toBe(0);
    expect(body.cards).toEqual([]);
    expect(body.emptyMessage).toBe("今月の入力は完了しています");
  });
});
