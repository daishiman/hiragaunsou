import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";

/**
 * /api/rate-master (率マスタ設定) のRoute Handlerを検証する。
 *
 * このルートで守りたいのは
 *   1. マスタ編集権限とCSRF防御 (率は全車両の損益に効くので、閲覧のみのロールに触らせない)
 *   2. 入力値の検証 (率に 17.48 が入ると一般管理費が売上の17倍になる)
 *   3. 保存したら必ず収支表を作り直すこと (画面の率と表の数字が食い違ったまま残らない)
 * の3点。率の計算そのものは tests/calc 側で検証済み。
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

const { setRateMock, listRatesMock } = vi.hoisted(() => ({
  setRateMock: vi.fn(),
  listRatesMock: vi.fn(async () => []),
}));
vi.mock("../../src/infrastructure/db/D1MasterRepository", () => ({
  D1RateMasterRepository: class {
    setRate = setRateMock;
    listRates = listRatesMock;
    getRates = vi.fn(async () => ({ adminFeeRate: 0.1748 }));
    getDeficitThresholds = vi.fn(async () => ({ breakEvenKmPrice: 177 }));
    getRate = vi.fn(async (_k: string, _ym: string, fallback: number) => fallback);
  },
  D1VehicleMasterRepository: class {
    findAllActive = vi.fn(async () => []);
  },
  D1DriverMasterRepository: class {
    findAll = vi.fn(async () => []);
  },
  RATE_KEYS: {},
}));

vi.mock("../../src/infrastructure/db/D1ImportBatchRepository", () => ({
  D1ImportBatchRepository: class {
    findRawRows = vi.fn(async () => []);
  },
}));
vi.mock("../../src/infrastructure/db/D1VehiclePlOverrideRepository", () => ({
  D1VehiclePlOverrideRepository: class {
    findByYearMonth = async () => [];
  },
}));
vi.mock("../../src/infrastructure/db/D1VehiclePlRepository", () => ({
  D1VehiclePlRepository: class {
    upsertMany = vi.fn();
  },
}));
vi.mock("../../src/infrastructure/db/D1ManualInputRepository", () => ({
  D1ManualInputRepository: class {
    findByYearMonth = vi.fn(async () => []);
  },
}));
vi.mock("../../src/infrastructure/db/D1CleansingDecisionRepository", () => ({
  D1CleansingDecisionRepository: class {
    findByYearMonth = vi.fn(async () => []);
  },
  D1AppSettingRepository: class {
    get = vi.fn(async () => null);
  },
  APP_SETTING_KEYS: { kirinTargetVehicleNos: "kirin_target_vehicle_nos" },
}));

const { finalizeExecuteMock } = vi.hoisted(() => ({ finalizeExecuteMock: vi.fn() }));
vi.mock("../../src/usecase/steps/finalizeMonthlyPl", () => ({
  FinalizeMonthlyPlUseCase: class {
    execute = finalizeExecuteMock;
  },
}));

function postRate(body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/rate-master/route").then(({ POST }) =>
    POST(
      new Request("http://test/api/rate-master", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function getRates(url: string) {
  return import("../../app/api/rate-master/route").then(({ GET }) =>
    GET(new Request(url, { headers: { origin: ORIGIN } })),
  );
}

const validBody = {
  key: "admin_fee_rate",
  yearMonth: null,
  value: 0.1748,
  recalculateYearMonth: "2026-05",
};

beforeEach(() => {
  sessionRef.current = adminSession;
  setRateMock.mockReset().mockResolvedValue(undefined);
  finalizeExecuteMock.mockReset().mockResolvedValue({ vehicleCount: 101 });
});

describe("POST /api/rate-master のガード", () => {
  it("未ログインなら401(率に触れない)", async () => {
    sessionRef.current = null;
    const res = await postRate(validBody);
    expect(res.status).toBe(401);
    expect(setRateMock).not.toHaveBeenCalled();
  });

  it("閲覧のみの社長ロールは率を変えられないので401", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    const res = await postRate(validBody);
    expect(res.status).toBe(401);
    expect(setRateMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const res = await postRate(validBody, { origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(setRateMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/rate-master の入力検証", () => {
  it("カタログに無いキーは400(任意のキーを生やさせない)", async () => {
    const res = await postRate({ ...validBody, key: "arbitrary_key" });
    expect(res.status).toBe(400);
    expect(setRateMock).not.toHaveBeenCalled();
  });

  /** 17.48% のつもりで 17.48 を入れる事故。通すと一般管理費が売上の17倍になる。 */
  it("率に1を超える値は400", async () => {
    const res = await postRate({ ...validBody, value: 17.48 });
    expect(res.status).toBe(400);
    expect(setRateMock).not.toHaveBeenCalled();
  });

  it("負値は400", async () => {
    const res = await postRate({ ...validBody, value: -0.1 });
    expect(res.status).toBe(400);
  });

  it("yearMonth が YYYY-MM 形式でなければ400", async () => {
    const res = await postRate({ ...validBody, yearMonth: "2026/05" });
    expect(res.status).toBe(400);
    expect(setRateMock).not.toHaveBeenCalled();
  });

  it("円建ての項目は1を超える値を受け付ける", async () => {
    const res = await postRate({ ...validBody, key: "bonus_annual", value: 480000 });
    expect(res.status).toBe(200);
    expect(setRateMock).toHaveBeenCalledWith("bonus_annual", null, 480000, "user-admin");
  });
});

describe("POST /api/rate-master の保存と再計算", () => {
  it("保存したら対象月の収支表を作り直す", async () => {
    const res = await postRate(validBody);
    expect(res.status).toBe(200);
    expect(setRateMock).toHaveBeenCalledWith("admin_fee_rate", null, 0.1748, "user-admin");
    expect(finalizeExecuteMock).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({
      recalculated: { yearMonth: "2026-05", vehicleCount: 101 },
    });
  });

  it("月別値として保存できる(その月だけ率を変える)", async () => {
    await postRate({ ...validBody, yearMonth: "2026-05" });
    expect(setRateMock).toHaveBeenCalledWith("admin_fee_rate", "2026-05", 0.1748, "user-admin");
  });

  it("再計算対象月の指定が無ければ保存だけして再計算しない", async () => {
    const res = await postRate({ ...validBody, recalculateYearMonth: undefined });
    expect(res.status).toBe(200);
    expect(setRateMock).toHaveBeenCalled();
    expect(finalizeExecuteMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/rate-master", () => {
  it("閲覧のみのロールには返さない(率は編集権限者の情報)", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    const res = await getRates("http://test/api/rate-master?ym=2026-05");
    expect(res.status).toBe(401);
  });

  it("ym が無ければ400", async () => {
    const res = await getRates("http://test/api/rate-master");
    expect(res.status).toBe(400);
  });

  it("カタログ・保存行・解決値をまとめて返す", async () => {
    const res = await getRates("http://test/api/rate-master?ym=2026-05");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      catalog: unknown[];
      entries: unknown[];
      resolved: Record<string, number>;
    };
    expect(body.catalog.length).toBeGreaterThan(0);
    expect(body.entries).toEqual([]);
    // 「行が無いキーは既定値で動いている」ことを画面で示せるよう、解決値も返す
    expect(body.resolved.adminFeeRate).toBe(0.1748);
  });
});
