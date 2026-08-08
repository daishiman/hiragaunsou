import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";
import { VehiclePlOverrideConflictError } from "../../src/usecase/steps/saveVehiclePlOverride";

/**
 * /api/vehicle-pl/override (収支表の数値を人が手で上書きする) のRoute Handlerを検証する。
 *
 * このルートが守るべきなのは
 *   1. 入力権限とCSRF防御 (上書きは収支表の数字を直接書き換えるので、閲覧のみのロールに触らせない)
 *   2. 再計算をいつ走らせるかの指定を、握りつぶさずユースケースに渡すこと
 *      (上書きだけ保存して再計算を飛ばすと、画面の上書き値と収支表の合計が食い違ったまま残るので、
 *       後回しにするのは反映待ちとして件数に出る収支表の画面からだけ)
 *   3. 数値でない値を黙って0にしないこと (空文字やnullは「未入力」であって「0」ではない)
 * の3点。上書き可能な項目かどうかの判定は tests/domain/vehiclePlOverride.test.ts 側で検証済み。
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

const { findByYearMonthMock } = vi.hoisted(() => ({
  findByYearMonthMock: vi.fn(async () => [] as unknown[]),
}));
vi.mock("../../src/infrastructure/db/D1VehiclePlOverrideRepository", () => ({
  D1VehiclePlOverrideRepository: class {
    findByYearMonth = findByYearMonthMock;
    upsert = vi.fn();
    remove = vi.fn();
  },
}));

// 上書きの保存・取消はユースケースの責務。ここではルートが「正しい引数で呼ぶか」だけを見る。
const { saveExecuteMock, clearExecuteMock } = vi.hoisted(() => ({
  saveExecuteMock: vi.fn(),
  clearExecuteMock: vi.fn(),
}));
vi.mock("../../src/usecase/steps/saveVehiclePlOverride", () => ({
  SaveVehiclePlOverrideUseCase: class {
    execute = saveExecuteMock;
  },
  ClearVehiclePlOverrideUseCase: class {
    execute = clearExecuteMock;
  },
  // 競合はルートが型で判別して409に振り分ける。ここでも同じ型として使えるよう一緒に差し替える。
  VehiclePlOverrideConflictError: class extends Error {},
}));

// 再計算まわりは実体を触らせない (D1が無い環境でルートを組み立てられるようにするため)。
vi.mock("../../src/usecase/steps/recalculateMonthlyPl", () => ({
  RecalculateMonthlyPlUseCase: class {},
}));
vi.mock("../../src/usecase/steps/finalizeMonthlyPl", () => ({
  FinalizeMonthlyPlUseCase: class {},
}));
vi.mock("../../src/infrastructure/db/D1MasterRepository", () => ({
  D1RateMasterRepository: class {},
  D1VehicleMasterRepository: class {},
  D1DriverMasterRepository: class {},
}));
vi.mock("../../src/infrastructure/db/D1ImportBatchRepository", () => ({
  D1ImportBatchRepository: class {},
}));
vi.mock("../../src/infrastructure/db/D1VehiclePlRepository", () => ({
  D1VehiclePlRepository: class {},
}));
vi.mock("../../src/infrastructure/db/D1ManualInputRepository", () => ({
  D1ManualInputRepository: class {},
}));
vi.mock("../../src/infrastructure/db/D1AuditLogRepository", () => ({
  D1AuditLogRepository: class {
    record = vi.fn();
  },
}));
vi.mock("../../src/infrastructure/db/D1CleansingDecisionRepository", () => ({
  D1CleansingDecisionRepository: class {},
  D1AppSettingRepository: class {},
  APP_SETTING_KEYS: { kirinTargetVehicleNos: "kirin_target_vehicle_nos" },
}));

function post(body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/vehicle-pl/override/route").then(({ POST }) =>
    POST(
      new Request("http://test/api/vehicle-pl/override", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function del(query: string, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/vehicle-pl/override/route").then(({ DELETE }) =>
    DELETE(new Request(`http://test/api/vehicle-pl/override${query}`, { method: "DELETE", headers })),
  );
}

function get(query: string) {
  return import("../../app/api/vehicle-pl/override/route").then(({ GET }) =>
    GET(new Request(`http://test/api/vehicle-pl/override${query}`, { headers: { origin: ORIGIN } })),
  );
}

const validBody = {
  yearMonth: "2026-05",
  vehicleNo: "12",
  values: { fuelCost: 123456 },
  reason: "伝票の付け替え漏れを反映",
};

beforeEach(() => {
  sessionRef.current = inputSession;
  saveExecuteMock.mockReset().mockResolvedValue({ recalculated: { vehicleCount: 101 } });
  clearExecuteMock.mockReset().mockResolvedValue({ recalculated: { vehicleCount: 101 } });
  findByYearMonthMock.mockReset().mockResolvedValue([]);
});

describe("POST /api/vehicle-pl/override のガード", () => {
  it("未ログインなら401", async () => {
    sessionRef.current = null;
    const res = await post(validBody);
    expect(res.status).toBe(401);
    expect(saveExecuteMock).not.toHaveBeenCalled();
  });

  it("閲覧のみの社長ロールは上書きできないので401", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    const res = await post(validBody);
    expect(res.status).toBe(401);
    expect(saveExecuteMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const res = await post(validBody, { origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(saveExecuteMock).not.toHaveBeenCalled();
  });

  it("yearMonth または vehicleNo が無ければ400", async () => {
    expect((await post({ ...validBody, vehicleNo: undefined })).status).toBe(400);
    expect((await post({ ...validBody, yearMonth: undefined })).status).toBe(400);
    expect(saveExecuteMock).not.toHaveBeenCalled();
  });

  it("本文がJSONでなくても落ちず400を返す", async () => {
    const { POST } = await import("../../app/api/vehicle-pl/override/route");
    const res = await POST(
      new Request("http://test/api/vehicle-pl/override", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/vehicle-pl/override の値の受け取り", () => {
  it("数値に直せる値だけをユースケースへ渡す", async () => {
    // 空文字・null・数値にならない文字列は「未入力」であって0ではない。
    // ここで0に丸めると、触っていない項目まで0で上書きされて損益が壊れる。
    await post({
      ...validBody,
      values: { fuelCost: "123456", repairCost: "", tollCost: null, driverCost: "あ" },
    });
    expect(saveExecuteMock).toHaveBeenCalledTimes(1);
    expect(saveExecuteMock.mock.calls[0][0].values).toEqual({ fuelCost: 123456 });
  });

  it("excluded は真偽値として厳密に渡す(未指定はfalse)", async () => {
    await post(validBody);
    expect(saveExecuteMock.mock.calls[0][0].excluded).toBe(false);
    await post({ ...validBody, excluded: true });
    expect(saveExecuteMock.mock.calls[1][0].excluded).toBe(true);
  });

  it("誰が直したかを監査できるようセッションの本人情報を渡す", async () => {
    await post(validBody);
    expect(saveExecuteMock.mock.calls[0][0]).toMatchObject({
      actorId: "user-input",
      actorName: "入力担当",
      reason: "伝票の付け替え漏れを反映",
    });
  });

  it("ユースケースが弾いた項目は400として理由を返す", async () => {
    saveExecuteMock.mockRejectedValue(new Error("上書きできない項目です: profit"));
    const res = await post({ ...validBody, values: { profit: 1 } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "上書きできない項目です: profit" });
  });

  /**
   * 収支表の画面から続けて直すときは、保存だけ済ませて再計算は溜める。
   * ここを既定(即時再計算)のまま送ってしまうと1件ごとに月まるごとの再計算が走るので、
   * 指定がそのままユースケースに届くことを固定する。
   */
  it("再計算の後回し指定をそのままユースケースに渡す", async () => {
    await post({ ...validBody, deferRecalculation: true });
    expect(saveExecuteMock.mock.calls[0][0].deferRecalculation).toBe(true);
  });

  /**
   * 「まだ直しが無い」と思って開いた画面からの保存は expectedUpdatedAt: null で来る。
   * 未指定(検査しない)と null(まだ無いはず)は意味が違うので、潰さずに渡す。
   */
  it("開いた時点の最終更新時刻は null と未指定を区別して渡す", async () => {
    await post({ ...validBody, expectedUpdatedAt: null });
    expect(saveExecuteMock.mock.calls[0][0]).toHaveProperty("expectedUpdatedAt", null);

    await post(validBody);
    expect(saveExecuteMock.mock.calls[1][0]).not.toHaveProperty("expectedUpdatedAt");
  });

  it("他の人が先に直していた場合は409として知らせる", async () => {
    saveExecuteMock.mockRejectedValue(new VehiclePlOverrideConflictError("他の人が先に直しました"));
    const res = await post(validBody);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ conflict: true });
  });
});

describe("DELETE /api/vehicle-pl/override", () => {
  it("閲覧のみのロールは取り消せないので401", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    const res = await del("?yearMonth=2026-05&vehicleNo=12");
    expect(res.status).toBe(401);
    expect(clearExecuteMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const res = await del("?yearMonth=2026-05&vehicleNo=12", { origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(clearExecuteMock).not.toHaveBeenCalled();
  });

  it("yearMonth または vehicleNo が無ければ400", async () => {
    expect((await del("?yearMonth=2026-05")).status).toBe(400);
    expect((await del("?vehicleNo=12")).status).toBe(400);
    expect(clearExecuteMock).not.toHaveBeenCalled();
  });

  it("取り消しの結果(再計算件数)をそのまま返す", async () => {
    const res = await del("?yearMonth=2026-05&vehicleNo=12");
    expect(res.status).toBe(200);
    expect(clearExecuteMock).toHaveBeenCalledWith({
      yearMonth: "2026-05",
      vehicleNo: "12",
      actorId: "user-input",
      actorName: "入力担当",
    });
    expect(await res.json()).toMatchObject({ recalculated: { vehicleCount: 101 } });
  });

  it("ユースケースの失敗は400として理由を返す", async () => {
    clearExecuteMock.mockRejectedValue(new Error("その上書きは存在しません"));
    const res = await del("?yearMonth=2026-05&vehicleNo=99");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "その上書きは存在しません" });
  });
});

describe("GET /api/vehicle-pl/override", () => {
  it("未ログインなら401", async () => {
    sessionRef.current = null;
    const res = await get("?yearMonth=2026-05");
    expect(res.status).toBe(401);
  });

  it("yearMonth が無ければ400", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
  });

  /** 上書き一覧は「人が直した行」を収支表で色分けするために使う。閲覧ロールにも要る。 */
  it("閲覧のみのロールでもその月の上書き一覧を取得できる", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    findByYearMonthMock.mockResolvedValue([{ vehicleNo: "12", excluded: false }]);
    const res = await get("?yearMonth=2026-05");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      yearMonth: "2026-05",
      overrides: [{ vehicleNo: "12" }],
    });
  });
});
