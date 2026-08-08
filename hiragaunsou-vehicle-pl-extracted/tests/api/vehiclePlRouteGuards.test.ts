import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";
import { VEHICLE_PL_FIELDS } from "../../src/domain/entities/VehiclePl";

/**
 * GET /api/vehicle-pl (F1 月次収支グリッド) のガードと配線を検証する。
 * 未ログイン401は tests/api/routeAuthGuards.test.ts で網羅済み。
 * ここでは権限不足・バリデーション・両リポジトリへの yearMonth 受け渡しと
 * 異常値ハイライトの合流結果を扱う。
 */
const { sessionRef, findByYearMonthMock, findOpenByYearMonthMock } = vi.hoisted(() => ({
  sessionRef: { current: null as SessionUser | null },
  findByYearMonthMock: vi.fn(),
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

vi.mock("../../src/infrastructure/db/D1VehiclePlRepository", () => ({
  D1VehiclePlRepository: class {
    findByYearMonth = findByYearMonthMock;
  },
}));

vi.mock("../../src/infrastructure/db/D1ReviewFlagRepository", () => ({
  D1ReviewFlagRepository: class {
    findOpenByYearMonth = findOpenByYearMonthMock;
  },
}));

vi.mock("../../src/infrastructure/db/D1VehiclePlOverrideRepository", () => ({
  D1VehiclePlOverrideRepository: class {
    findByYearMonth = async () => [];
  },
}));

type GridBody = {
  yearMonth: string;
  fields: string[];
  rows: { vehicleNo: string; values: Record<string, unknown>; highlightedFields: string[] }[];
  isEmpty: boolean;
};

async function getGrid(url: string) {
  const { GET } = await import("../../app/api/vehicle-pl/route");
  return GET(new Request(url));
}

describe("GET /api/vehicle-pl", () => {
  beforeEach(() => {
    sessionRef.current = {
      id: "user-1",
      email: "staff@example.co.jp",
      name: "山本",
      role: "input_staff",
    };
    findByYearMonthMock.mockReset();
    findByYearMonthMock.mockResolvedValue([]);
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
    const res = await getGrid("http://test/api/vehicle-pl?yearMonth=2026-05");
    expect(res.status).toBe(401);
    expect(findByYearMonthMock).not.toHaveBeenCalled();
  });

  it("yearMonth が無ければ400", async () => {
    const res = await getGrid("http://test/api/vehicle-pl");
    expect(res.status).toBe(400);
    expect(findByYearMonthMock).not.toHaveBeenCalled();
  });

  it("yearMonth が空文字なら400", async () => {
    const res = await getGrid("http://test/api/vehicle-pl?yearMonth=");
    expect(res.status).toBe(400);
  });

  it("収支と要確認フラグの両リポジトリを同じ yearMonth で引く", async () => {
    await getGrid("http://test/api/vehicle-pl?yearMonth=2026-05");
    expect(findByYearMonthMock).toHaveBeenCalledWith("2026-05");
    expect(findOpenByYearMonthMock).toHaveBeenCalledWith("2026-05");
  });

  it("車両行に異常値フラグのフィールドをハイライトとして合流させる", async () => {
    findByYearMonthMock.mockResolvedValue([
      { no: "2", fuelCost: 120000 },
      { no: "5", fuelCost: 80000 },
    ]);
    findOpenByYearMonthMock.mockResolvedValue([
      {
        id: "f-1",
        vehicleNo: "2",
        field: "fuelCost",
        type: "spike",
        severity: "warning",
        message: "燃料費が平常月の2倍です",
        status: "open",
      },
      // vehicleNo/field が無いフラグ(月全体の未入力等)はセル単位のハイライト対象外
      {
        id: "f-2",
        vehicleNo: null,
        field: null,
        type: "missing",
        severity: "critical",
        message: "未入力があります",
        status: "open",
      },
    ]);

    const res = await getGrid("http://test/api/vehicle-pl?yearMonth=2026-05");
    expect(res.status).toBe(200);

    const body = (await res.json()) as GridBody;
    expect(body.yearMonth).toBe("2026-05");
    expect(body.isEmpty).toBe(false);
    expect(body.rows.map((r) => r.vehicleNo)).toEqual(["2", "5"]);
    expect(body.rows[0].highlightedFields).toEqual(["fuelCost"]);
    expect(body.rows[1].highlightedFields).toEqual([]);
    expect(body.fields).toEqual([...VEHICLE_PL_FIELDS]);
  });

  it("データが1件も無い月は isEmpty=true で空配列を返す(境界値)", async () => {
    const res = await getGrid("http://test/api/vehicle-pl?yearMonth=2026-12");
    const body = (await res.json()) as GridBody;
    expect(body.isEmpty).toBe(true);
    expect(body.rows).toEqual([]);
  });

  it("欠損している収支項目は null で埋めて全列を返す", async () => {
    findByYearMonthMock.mockResolvedValue([{ no: "7" }]);
    const res = await getGrid("http://test/api/vehicle-pl?yearMonth=2026-05");
    const body = (await res.json()) as GridBody;

    expect(Object.keys(body.rows[0].values)).toEqual([...VEHICLE_PL_FIELDS]);
    expect(body.rows[0].values.no).toBe("7");
    const missingFields = VEHICLE_PL_FIELDS.filter((f) => f !== "no");
    expect(missingFields.every((f) => body.rows[0].values[f] === null)).toBe(true);
  });
});
