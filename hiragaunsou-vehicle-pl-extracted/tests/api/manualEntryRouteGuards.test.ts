import { describe, expect, it, vi, beforeEach } from "vitest";
import { DEFAULT_KIRIN_TARGET_VEHICLES } from "../../src/domain/rules/kirinAllocation";

/**
 * /api/manual-entry (層③手入力の保存・確定API) のRoute Handlerロジックを検証する。
 *
 * このルートは「値を集めてUseCaseに渡すだけ」だが、渡すまでの間に業務上重要な分岐を持つ:
 *  1. input権限ガードとCSRF(Origin)ガード
 *  2. インタンク単価の rate_master への副次保存(負値の丸め)
 *  3. キリン配賦先車番の3段フォールバック(リクエスト指定 > app_setting > 既定値)
 *  4. saveOnly による「下書き保存だけ」と「確定まで実行」の分岐
 * これらは実装の配線ミスが静かに業務データを壊すため、Route Handler経由で確認する。
 * (buildManualInputs / allocateKirinSupport は純粋関数なのでモックせず実物を使い、
 *  UseCaseへ渡る値そのものを検証する)
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const adminSession = { id: "user-1", email: "admin@example.co.jp", name: "今西", role: "admin" as const };
const executiveSession = { id: "user-9", email: "exec@example.co.jp", name: "社長", role: "executive" as const };

const { sessionRef } = vi.hoisted(() => ({
  sessionRef: { current: null as { id: string; email: string; name: string; role: string } | null },
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

const { manualFindMock, upsertManyMock } = vi.hoisted(() => ({
  manualFindMock: vi.fn(),
  upsertManyMock: vi.fn(),
}));
vi.mock("../../src/infrastructure/db/D1ManualInputRepository", () => ({
  D1ManualInputRepository: class {
    findByYearMonth = manualFindMock;
    upsertMany = upsertManyMock;
  },
}));

const { appSettingGetMock, appSettingSetMock, cleansingFindMock } = vi.hoisted(() => ({
  appSettingGetMock: vi.fn(),
  appSettingSetMock: vi.fn(),
  cleansingFindMock: vi.fn(),
}));
vi.mock("../../src/infrastructure/db/D1CleansingDecisionRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/infrastructure/db/D1CleansingDecisionRepository")>();
  return {
    APP_SETTING_KEYS: actual.APP_SETTING_KEYS,
    D1AppSettingRepository: class {
      get = appSettingGetMock;
      set = appSettingSetMock;
    },
    D1CleansingDecisionRepository: class {
      findByYearMonth = cleansingFindMock;
    },
  };
});

const { setRateMock } = vi.hoisted(() => ({ setRateMock: vi.fn() }));
vi.mock("../../src/infrastructure/db/D1MasterRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/infrastructure/db/D1MasterRepository")>();
  return {
    RATE_KEYS: actual.RATE_KEYS,
    D1RateMasterRepository: class {
      setRate = setRateMock;
    },
    D1VehicleMasterRepository: class {},
    D1DriverMasterRepository: class {},
  };
});

vi.mock("../../src/infrastructure/db/D1ImportBatchRepository", () => ({
  D1ImportBatchRepository: class {},
}));
vi.mock("../../src/infrastructure/db/D1VehiclePlRepository", () => ({
  D1VehiclePlRepository: class {},
}));

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("../../src/usecase/steps/finalizeMonthlyPl", () => ({
  FinalizeMonthlyPlUseCase: class {
    execute = executeMock;
  },
}));

async function importRoute() {
  return import("../../app/api/manual-entry/route");
}

function getRequest(query = "") {
  return new Request(`http://test/api/manual-entry${query}`);
}

type PostBody = Record<string, unknown>;

function postRequest(body: PostBody | string, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  return new Request("http://test/api/manual-entry", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** 最低限の手入力1件。個々の項目の正規化は buildManualInputs のテストで検証済み。 */
const rawInput = { vehicleNo: "24", fuelInQty: 100, repairActual: 5000 };

beforeEach(() => {
  vi.clearAllMocks();
  sessionRef.current = adminSession;
  manualFindMock.mockResolvedValue([]);
  upsertManyMock.mockResolvedValue(undefined);
  appSettingGetMock.mockResolvedValue(null);
  appSettingSetMock.mockResolvedValue(undefined);
  cleansingFindMock.mockResolvedValue([]);
  setRateMock.mockResolvedValue(undefined);
  executeMock.mockResolvedValue({ yearMonth: "2026-05", vehicleCount: 3 });
});

describe("GET /api/manual-entry", () => {
  it("input権限を持たないロール(executive)は401", async () => {
    sessionRef.current = executiveSession;
    const { GET } = await importRoute();
    const res = await GET(getRequest("?yearMonth=2026-05"));

    expect(res.status).toBe(401);
    // 権限で弾いた時点でDBには一切触れない
    expect(manualFindMock).not.toHaveBeenCalled();
    expect(appSettingGetMock).not.toHaveBeenCalled();
  });

  it("yearMonthが無ければ400", async () => {
    const { GET } = await importRoute();
    const res = await GET(getRequest());

    expect(res.status).toBe(400);
    expect(manualFindMock).not.toHaveBeenCalled();
  });

  it("保存済み入力と配賦先車番設定をマージして返す", async () => {
    const records = [{ vehicleNo: "24", repairActual: 5000 }];
    manualFindMock.mockResolvedValue(records);
    appSettingGetMock.mockResolvedValue("24,300");

    const { GET } = await importRoute();
    const res = await GET(getRequest("?yearMonth=2026-05"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      yearMonth: "2026-05",
      manualInputs: records,
      kirinTargetVehicleNos: ["24", "300"],
    });
    expect(manualFindMock).toHaveBeenCalledWith("2026-05");
    expect(appSettingGetMock).toHaveBeenCalledWith("kirin_target_vehicle_nos");
  });

  it("入力の取得と設定の取得を並行実行する(直列だと待ち合わせで完了しない)", async () => {
    // 設定取得が呼ばれるまで入力取得を解決させない。直列実装ならここでタイムアウトする。
    let releaseManualFind: () => void = () => {};
    const manualFindGate = new Promise<void>((resolve) => {
      releaseManualFind = resolve;
    });
    manualFindMock.mockImplementation(async () => {
      await manualFindGate;
      return [];
    });
    appSettingGetMock.mockImplementation(async () => {
      releaseManualFind();
      return null;
    });

    const { GET } = await importRoute();
    const res = await GET(getRequest("?yearMonth=2026-05"));

    expect(res.status).toBe(200);
  });

  it.each([
    ["未設定(null)", null],
    ["空文字", ""],
    ["カンマと空白のみ", " , , "],
  ])("配賦先車番が%sなら既定値へフォールバックする", async (_label, stored) => {
    appSettingGetMock.mockResolvedValue(stored);

    const { GET } = await importRoute();
    const res = await GET(getRequest("?yearMonth=2026-05"));

    const body = (await res.json()) as { kirinTargetVehicleNos: string[] };
    expect(body.kirinTargetVehicleNos).toEqual([...DEFAULT_KIRIN_TARGET_VEHICLES]);
  });

  it("配賦先車番の前後空白と空要素を除去する", async () => {
    appSettingGetMock.mockResolvedValue(" 24 , ,300 ,");

    const { GET } = await importRoute();
    const res = await GET(getRequest("?yearMonth=2026-05"));

    const body = (await res.json()) as { kirinTargetVehicleNos: string[] };
    expect(body.kirinTargetVehicleNos).toEqual(["24", "300"]);
  });
});

describe("POST /api/manual-entry のガード", () => {
  it("input権限を持たないロール(executive)は401", async () => {
    sessionRef.current = executiveSession;
    const { POST } = await importRoute();
    const res = await POST(postRequest({ yearMonth: "2026-05", manualInputs: [rawInput] }));

    expect(res.status).toBe(401);
    expect(upsertManyMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      postRequest({ yearMonth: "2026-05", manualInputs: [rawInput] }, "https://evil.example.com"),
    );

    expect(res.status).toBe(403);
    expect(upsertManyMock).not.toHaveBeenCalled();
  });

  it("Originヘッダーが無ければ403(ブラウザ外からの呼び出し)", async () => {
    const { POST } = await importRoute();
    const res = await POST(postRequest({ yearMonth: "2026-05", manualInputs: [rawInput] }, null));

    expect(res.status).toBe(403);
  });

  it.each([
    ["yearMonthが無い", { manualInputs: [rawInput] }],
    ["yearMonthが空文字", { yearMonth: "", manualInputs: [rawInput] }],
    ["manualInputsが無い", { yearMonth: "2026-05" }],
    ["manualInputsが配列でない", { yearMonth: "2026-05", manualInputs: { vehicleNo: "24" } }],
  ])("%sなら400", async (_label, body) => {
    const { POST } = await importRoute();
    const res = await POST(postRequest(body as PostBody));

    expect(res.status).toBe(400);
    expect(upsertManyMock).not.toHaveBeenCalled();
  });

  it("bodyがJSONとして壊れていても例外にせず400", async () => {
    const { POST } = await importRoute();
    const res = await POST(postRequest("{壊れたJSON"));

    expect(res.status).toBe(400);
  });
});

describe("POST /api/manual-entry のインタンク単価保存", () => {
  async function post(body: PostBody) {
    const { POST } = await importRoute();
    return POST(postRequest({ yearMonth: "2026-05", manualInputs: [rawInput], ...body }));
  }

  it("有限の数値なら rate_master へ保存する", async () => {
    await post({ tankPricePerLiter: 148.5 });

    expect(setRateMock).toHaveBeenCalledWith("tank_price", "2026-05", 148.5, adminSession.id);
  });

  it("0円も入力値として保存する(未入力と区別する境界値)", async () => {
    await post({ tankPricePerLiter: 0 });

    expect(setRateMock).toHaveBeenCalledWith("tank_price", "2026-05", 0, adminSession.id);
  });

  it("負値は0に丸めて保存する", async () => {
    await post({ tankPricePerLiter: -1 });

    expect(setRateMock).toHaveBeenCalledWith("tank_price", "2026-05", 0, adminSession.id);
  });

  it.each([
    ["未指定", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["数値でない文字列", "148"],
    ["null", null],
  ])("単価が%sのときは保存しない", async (_label, value) => {
    await post({ tankPricePerLiter: value });

    expect(setRateMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/manual-entry のキリン配賦先の決定", () => {
  async function postAndGetAllocations(body: PostBody) {
    const { POST } = await importRoute();
    const res = await POST(postRequest({ yearMonth: "2026-05", manualInputs: [rawInput], ...body }));
    expect(res.status).toBe(200);
    return (executeMock.mock.calls[0][0] as { kirinAllocations: { vehicleNo: string; amount: number }[] })
      .kirinAllocations;
  }

  it("リクエストで指定された配賦先を設定として保存し、その車番へ配賦する", async () => {
    // DBには別の設定が入っているが、リクエスト指定が優先されるべき
    appSettingGetMock.mockResolvedValue("999");

    const allocations = await postAndGetAllocations({
      kirin: { transportSupport: 600, managementSupport: 400, targetVehicleNos: ["11", "22"] },
    });

    expect(appSettingSetMock).toHaveBeenCalledWith("kirin_target_vehicle_nos", "11,22", adminSession.id);
    expect(allocations).toEqual([
      { vehicleNo: "11", amount: 500 },
      { vehicleNo: "22", amount: 500 },
    ]);
  });

  it("配賦先の指定が無ければ保存済み設定を使い、設定の上書きはしない", async () => {
    appSettingGetMock.mockResolvedValue("11, 22 ,33");

    const allocations = await postAndGetAllocations({
      kirin: { transportSupport: 300, managementSupport: 0 },
    });

    expect(appSettingSetMock).not.toHaveBeenCalled();
    expect(allocations.map((a) => a.vehicleNo)).toEqual(["11", "22", "33"]);
  });

  it("指定も設定も無ければ既定の専属2台へ配賦する", async () => {
    appSettingGetMock.mockResolvedValue(null);

    const allocations = await postAndGetAllocations({
      kirin: { transportSupport: 1000, managementSupport: 0 },
    });

    expect(allocations.map((a) => a.vehicleNo)).toEqual([...DEFAULT_KIRIN_TARGET_VEHICLES]);
  });

  it("指定が空配列なら設定を上書きせず既存設定へフォールバックする", async () => {
    appSettingGetMock.mockResolvedValue("11,22");

    const allocations = await postAndGetAllocations({
      kirin: { transportSupport: 1000, managementSupport: 0, targetVehicleNos: [] },
    });

    expect(appSettingSetMock).not.toHaveBeenCalled();
    expect(allocations.map((a) => a.vehicleNo)).toEqual(["11", "22"]);
  });

  it("協力金の指定が無ければ配賦は行わない", async () => {
    const allocations = await postAndGetAllocations({});

    expect(allocations).toEqual([]);
    expect(appSettingSetMock).not.toHaveBeenCalled();
  });

  it("協力金が0円なら配賦行を作らない(0円の行を残さない)", async () => {
    const allocations = await postAndGetAllocations({ kirin: { targetVehicleNos: ["11", "22"] } });

    expect(allocations).toEqual([]);
    // 金額が0でも配賦先の設定自体は保存する
    expect(appSettingSetMock).toHaveBeenCalledWith("kirin_target_vehicle_nos", "11,22", adminSession.id);
  });
});

describe("POST /api/manual-entry の保存と確定", () => {
  it("saveOnlyなら入力を保存するだけで確定は行わない", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      postRequest({
        yearMonth: "2026-05",
        manualInputs: [rawInput, { vehicleNo: "300" }],
        saveOnly: true,
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ yearMonth: "2026-05", saved: 2 });
    expect(upsertManyMock).toHaveBeenCalledTimes(1);
    expect(executeMock).not.toHaveBeenCalled();
    // 確定しない以上、締めに必要なデータの読み出しも発生しない
    expect(manualFindMock).not.toHaveBeenCalled();
    expect(cleansingFindMock).not.toHaveBeenCalled();
  });

  it("車番が空のレコードは保存対象から除外する", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      postRequest({
        yearMonth: "2026-05",
        manualInputs: [rawInput, { vehicleNo: "  " }, { vehicleNo: "" }],
        saveOnly: true,
      }),
    );

    expect(await res.json()).toEqual({ yearMonth: "2026-05", saved: 1 });
    expect(upsertManyMock.mock.calls[0][1]).toHaveLength(1);
  });

  it("手入力が空配列でも保存は実行され、saved:0を返す", async () => {
    const { POST } = await importRoute();
    const res = await POST(postRequest({ yearMonth: "2026-05", manualInputs: [], saveOnly: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ yearMonth: "2026-05", saved: 0 });
    expect(upsertManyMock).toHaveBeenCalledWith("2026-05", [], adminSession.id);
  });

  it("未入力の任意項目はnullのまま保存し、標準原価へのフォールバックを潰さない", async () => {
    const { POST } = await importRoute();
    await POST(
      postRequest({
        yearMonth: "2026-05",
        manualInputs: [{ vehicleNo: " 24 ", repairActual: "-3", adblue: "abc" }],
        saveOnly: true,
      }),
    );

    expect(upsertManyMock).toHaveBeenCalledWith(
      "2026-05",
      [
        {
          vehicleNo: "24",
          fuelInQty: 0,
          fuelOut: 0,
          fuelOutQty: 0,
          adblue: 0,
          repairActual: 0,
          tireActual: null,
          equip: 0,
          mainte: 0,
          tollActual: null,
          tollDiscountActual: null,
          miscOther: 0,
        },
      ],
      adminSession.id,
    );
  });

  it("saveOnlyでなければ保存済み全件とデータ整形の判断を渡して確定する", async () => {
    const savedRecords = [{ vehicleNo: "24" }, { vehicleNo: "300" }];
    const decisions = [{ rowKey: "r1", action: "exclude" }];
    manualFindMock.mockResolvedValue(savedRecords);
    cleansingFindMock.mockResolvedValue(decisions);

    const { POST } = await importRoute();
    const res = await POST(postRequest({ yearMonth: "2026-05", manualInputs: [rawInput] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ yearMonth: "2026-05", vehicleCount: 3, saved: 1 });
    // 今回触っていない車両を消さないため、リクエストのmanualInputsではなく保存済み全件を渡す
    expect(executeMock).toHaveBeenCalledWith({
      yearMonth: "2026-05",
      manualInputs: savedRecords,
      kirinAllocations: [],
      cleansingDecisions: decisions,
    });
    expect(cleansingFindMock).toHaveBeenCalledWith("2026-05", "sales_monitor");
  });

  it("確定は保存の後に行う(保存に失敗したら確定へ進まない)", async () => {
    upsertManyMock.mockRejectedValue(new Error("保存に失敗"));

    const { POST } = await importRoute();
    const res = await POST(postRequest({ yearMonth: "2026-05", manualInputs: [rawInput] }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "保存に失敗" });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("保存済み全件と整形判断の読み出しを並行実行する", async () => {
    let releaseManualFind: () => void = () => {};
    const manualFindGate = new Promise<void>((resolve) => {
      releaseManualFind = resolve;
    });
    manualFindMock.mockImplementation(async () => {
      await manualFindGate;
      return [];
    });
    cleansingFindMock.mockImplementation(async () => {
      releaseManualFind();
      return [];
    });

    const { POST } = await importRoute();
    const res = await POST(postRequest({ yearMonth: "2026-05", manualInputs: [rawInput] }));

    expect(res.status).toBe(200);
  });

  it("確定処理が失敗しても入力の保存は取り消さず、500とエラー内容を返す", async () => {
    executeMock.mockRejectedValue(new Error("締め処理に失敗しました"));

    const { POST } = await importRoute();
    const res = await POST(postRequest({ yearMonth: "2026-05", manualInputs: [rawInput] }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "締め処理に失敗しました" });
    expect(upsertManyMock).toHaveBeenCalledTimes(1);
  });

  it("Error以外が投げられたときは既定のエラーメッセージを返す", async () => {
    executeMock.mockRejectedValue("想定外");

    const { POST } = await importRoute();
    const res = await POST(postRequest({ yearMonth: "2026-05", manualInputs: [rawInput] }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "手入力の確定に失敗しました" });
  });
});
