import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";

/**
 * /api/vehicle-master/lease (STEP7 リース料・割賦支払額の修正) のRoute Handlerを検証する。
 *
 * このルートの要点は「収支表のセルを直接書き換えず、車両マスタを直してから作り直す」こと。
 * したがって検証すべきは
 *   1. 入力権限とCSRF防御
 *   2. toAmount による金額の丸め (負値・非数を0にする)
 *   3. マスタ更新のあとに必ず収支表の再計算が走ること
 * の3点で、FinalizeMonthlyPlUseCase 自体のロジックは tests/usecase 側で検証済み。
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

const { updateLeaseInstallmentMock, getRateMock } = vi.hoisted(() => ({
  updateLeaseInstallmentMock: vi.fn(),
  getRateMock: vi.fn(async (_key: string, _yearMonth: string, fallback: number) => fallback),
}));
vi.mock("../../src/infrastructure/db/D1MasterRepository", () => ({
  D1VehicleMasterRepository: class {
    updateLeaseInstallment = updateLeaseInstallmentMock;
    findAllActive = vi.fn(async () => []);
  },
  D1DriverMasterRepository: class {
    findAll = vi.fn(async () => []);
  },
  D1RateMasterRepository: class {
    getRates = vi.fn(async () => ({}));
    getRate = getRateMock;
  },
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

const { findManualInputsMock } = vi.hoisted(() => ({ findManualInputsMock: vi.fn() }));
vi.mock("../../src/infrastructure/db/D1ManualInputRepository", () => ({
  D1ManualInputRepository: class {
    findByYearMonth = findManualInputsMock;
  },
}));

const { findDecisionsMock } = vi.hoisted(() => ({ findDecisionsMock: vi.fn() }));
vi.mock("../../src/infrastructure/db/D1CleansingDecisionRepository", () => ({
  D1CleansingDecisionRepository: class {
    findByYearMonth = findDecisionsMock;
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

function postLease(body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/vehicle-master/lease/route").then(({ POST }) =>
    POST(
      new Request("http://test/api/vehicle-master/lease", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

/** toAmount に渡った値を updateLeaseInstallment の引数から読み取る */
async function amountsFor(lease: unknown, installment: unknown): Promise<[number, number]> {
  await postLease({ yearMonth: "2026-05", vehicleNo: "4242", lease, installment });
  const call = updateLeaseInstallmentMock.mock.calls.at(-1) as [string, number, number];
  return [call[1], call[2]];
}

beforeEach(() => {
  sessionRef.current = adminSession;
  updateLeaseInstallmentMock.mockReset().mockResolvedValue(undefined);
  findManualInputsMock.mockReset().mockResolvedValue([]);
  findDecisionsMock.mockReset().mockResolvedValue([]);
  finalizeExecuteMock.mockReset().mockResolvedValue({ vehicleCount: 24 });
});

describe("POST /api/vehicle-master/lease のガード", () => {
  it("未ログインなら401(マスタに触れない)", async () => {
    sessionRef.current = null;
    const res = await postLease({ yearMonth: "2026-05", vehicleNo: "4242", lease: 100000 });
    expect(res.status).toBe(401);
    expect(updateLeaseInstallmentMock).not.toHaveBeenCalled();
  });

  it("閲覧のみの社長ロールはマスタを直せないので401", async () => {
    sessionRef.current = { id: "user-exec", email: "exec@example.co.jp", name: "社長", role: "executive" };
    const res = await postLease({ yearMonth: "2026-05", vehicleNo: "4242", lease: 100000 });
    expect(res.status).toBe(401);
    expect(updateLeaseInstallmentMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const res = await postLease({ yearMonth: "2026-05", vehicleNo: "4242" }, {
      origin: "https://evil.example.com",
    });
    expect(res.status).toBe(403);
    expect(updateLeaseInstallmentMock).not.toHaveBeenCalled();
  });

  it("Originヘッダーが無ければ403", async () => {
    const res = await postLease({ yearMonth: "2026-05", vehicleNo: "4242" }, {});
    expect(res.status).toBe(403);
  });
});

describe("POST /api/vehicle-master/lease の入力検証", () => {
  it("yearMonthが無ければ400", async () => {
    const res = await postLease({ vehicleNo: "4242", lease: 100000 });
    expect(res.status).toBe(400);
    expect(updateLeaseInstallmentMock).not.toHaveBeenCalled();
  });

  it("vehicleNoが無ければ400(どの車両を直すか決まらない)", async () => {
    const res = await postLease({ yearMonth: "2026-05", lease: 100000 });
    expect(res.status).toBe(400);
  });

  it("vehicleNoが空文字なら400", async () => {
    const res = await postLease({ yearMonth: "2026-05", vehicleNo: "", lease: 100000 });
    expect(res.status).toBe(400);
  });

  it("JSONとして壊れているbodyは400", async () => {
    const { POST } = await import("../../app/api/vehicle-master/lease/route");
    const res = await POST(
      new Request("http://test/api/vehicle-master/lease", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("toAmount による金額の丸め", () => {
  it("負値は0にする(マイナスのリース料は存在しない)", async () => {
    expect(await amountsFor(-1, -100000)).toEqual([0, 0]);
  });

  it("非数(文字列・null・undefined)は0にする", async () => {
    expect(await amountsFor("abc", null)).toEqual([0, 0]);
    expect(await amountsFor(undefined, undefined)).toEqual([0, 0]);
  });

  it("数値として読める文字列は数値に直して受け付ける(フォームからの入力)", async () => {
    expect(await amountsFor("150000", "80000.5")).toEqual([150000, 80000.5]);
  });

  it("0ちょうどは有効な値として通す(リースを解約した車両)", async () => {
    expect(await amountsFor(0, 0)).toEqual([0, 0]);
  });

  // Infinity/NaN はJSONで表現できずnullとして届くため、非数と同じ経路で0になる
  it("Infinity・NaNは0にする", async () => {
    expect(await amountsFor(Number.POSITIVE_INFINITY, Number.NaN)).toEqual([0, 0]);
  });

  it("空文字はNumber(\"\")=0 として0になる(未入力=0円扱い)", async () => {
    expect(await amountsFor("", "")).toEqual([0, 0]);
  });
});

describe("POST /api/vehicle-master/lease の正常系", () => {
  it("マスタを直したあとに収支表を作り直し、対象車番と再計算件数を返す", async () => {
    findManualInputsMock.mockResolvedValue([{ yearMonth: "2026-05", field: "insVoluntary" }]);
    findDecisionsMock.mockResolvedValue([{ rowKey: "S-100-1", decision: "delete" }]);

    const res = await postLease({
      yearMonth: "2026-05",
      vehicleNo: "4242",
      lease: 120000,
      installment: 55000,
    });
    expect(res.status).toBe(200);
    expect(updateLeaseInstallmentMock).toHaveBeenCalledWith("4242", 120000, 55000);

    // STEP2の判断も手入力も引き継いだうえで作り直す(直した値だけ反映した表を作らない)
    expect(findDecisionsMock).toHaveBeenCalledWith("2026-05", "sales_monitor");
    expect(finalizeExecuteMock).toHaveBeenCalledWith({
      yearMonth: "2026-05",
      manualInputs: [{ yearMonth: "2026-05", field: "insVoluntary" }],
      cleansingDecisions: [{ rowKey: "S-100-1", decision: "delete" }],
      // キリンの受取額が0なら配賦も無い。金額があるときに引き継がれることは次のテストで見る。
      kirinAllocations: [],
      overrides: [],
    });

    expect((await res.json()) as unknown).toEqual({
      yearMonth: "2026-05",
      vehicleNo: "4242",
      vehicleCount: 24,
    });
  });

  /**
   * かつてこのAPIは再計算の材料を自前で集めており、キリンの配賦だけを渡し忘れていた。
   * その結果「リース料を1台直すと、24番・300番へのキリン協力金の配賦が全部消える」という
   * 一見無関係な副作用が出ていた(しかも受取額はどこにも保存されておらず、手入力画面で
   * 入れ直すまで戻らなかった)。材料集めを再計算ユースケースへ寄せたことの回帰テスト。
   */
  it("リース料の更新でも、保存済みのキリン受取額から配賦を作り直して引き継ぐ", async () => {
    findManualInputsMock.mockResolvedValue([]);
    findDecisionsMock.mockResolvedValue([]);
    getRateMock.mockImplementation(async (key: string) =>
      key === "kirin_transport_support" ? 300000 : key === "kirin_management_support" ? 200000 : 0,
    );

    const res = await postLease({ yearMonth: "2026-05", vehicleNo: "4242", lease: 120000 });

    expect(res.status).toBe(200);
    expect(finalizeExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kirinAllocations: [
          { vehicleNo: "24", amount: 250000 },
          { vehicleNo: "300", amount: 250000 },
        ],
      }),
    );
  });

  it("マスタ更新に失敗したら500で例外のメッセージを返し、再計算は走らせない", async () => {
    updateLeaseInstallmentMock.mockRejectedValue(new Error("D1_ERROR: no such column"));
    const res = await postLease({ yearMonth: "2026-05", vehicleNo: "4242", lease: 100000 });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: "D1_ERROR: no such column" });
    expect(finalizeExecuteMock).not.toHaveBeenCalled();
  });

  it("再計算で落ちても500として扱う", async () => {
    finalizeExecuteMock.mockRejectedValue(new Error("車両マスタが未登録です"));
    const res = await postLease({ yearMonth: "2026-05", vehicleNo: "4242", lease: 100000 });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: "車両マスタが未登録です" });
  });

  it("Error以外がthrowされても500で既定メッセージを返す", async () => {
    updateLeaseInstallmentMock.mockRejectedValue("boom");
    const res = await postLease({ yearMonth: "2026-05", vehicleNo: "4242" });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({
      error: "リース料・割賦支払額の更新に失敗しました",
    });
  });
});
