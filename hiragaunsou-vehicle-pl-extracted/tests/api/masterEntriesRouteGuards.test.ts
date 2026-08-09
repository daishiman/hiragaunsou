import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";

/**
 * 「まとめて保存する」入口 2本を検証する。
 *   POST /api/master-changes/entries … 車両マスタ・運転者マスタ
 *   POST /api/rate-master/entries    … 率マスタ
 *
 * 1件ずつの入口 (/entry, /api/rate-master) と業務上の意味は同じなので、
 * 権限とCSRFの守り方が**1件ずつのときと食い違っていないこと**をまず見る。
 * 入口が増えるたびに守りが緩むのが、この種の追加でいちばん起きやすい事故のため。
 *
 * そのうえで、まとめて受けるからこそ要る2点を見る:
 *   1. 1項目が保存できなくても、他の項目は保存されること
 *      (まとめて失敗にすると、直した10項目のうち9項目が消えて全部打ち直しになる)
 *   2. 収支表の作り直しが、何項目直しても最後に1回だけであること
 *      (1件ずつ走らせると10項目で10回作り直し、待ち時間がそのまま10倍になる)
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const adminSession: SessionUser = {
  id: "user-admin",
  email: "imanishi@example.co.jp",
  name: "今西",
  role: "admin",
};
const staffSession: SessionUser = {
  id: "user-staff",
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
  getCloudflareContext: vi.fn(async () => ({ env: { DB: {}, BETTER_AUTH_URL: ORIGIN } })),
}));
vi.mock("../../src/infrastructure/db/client", () => ({ createDb: vi.fn(() => ({})) }));

const mocks = vi.hoisted(() => ({
  writerWrite: vi.fn(),
  applierExecute: vi.fn(),
  findAllActive: vi.fn(),
  findAllDrivers: vi.fn(),
  listRates: vi.fn(),
  setRate: vi.fn(),
}));

vi.mock("../../app/_lib/masterChangeStack", () => ({
  masterChangeStack: () => ({
    writer: { write: mocks.writerWrite },
    applier: { execute: mocks.applierExecute },
  }),
}));

vi.mock("../../src/infrastructure/db/D1MasterRepository", () => ({
  D1VehicleMasterRepository: class {
    findAllActive = mocks.findAllActive;
  },
  D1DriverMasterRepository: class {
    findAll = mocks.findAllDrivers;
  },
  D1RateMasterRepository: class {
    listRates = mocks.listRates;
    setRate = mocks.setRate;
  },
}));

function post(path: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sessionRef.current = adminSession;
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.writerWrite.mockResolvedValue(undefined);
  mocks.applierExecute.mockResolvedValue({
    appliedYearMonths: ["2026-05"],
    applied: [{ yearMonth: "2026-05", vehicleCount: 3 }],
    heldBackYearMonths: ["2026-04"],
  });
  mocks.findAllActive.mockResolvedValue([
    { vehicleNo: "24", lease: 1000, vehicleType: "トラクタ" },
    { vehicleNo: "25", lease: 2000, vehicleType: null },
  ]);
  mocks.findAllDrivers.mockResolvedValue([
    { employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "300" },
  ]);
  mocks.listRates.mockResolvedValue([
    { key: "admin_fee_rate", yearMonth: null, value: 0.1748 },
    { key: "bonus_annual", yearMonth: "2026-05", value: 500000 },
  ]);
  mocks.setRate.mockResolvedValue(undefined);
});

describe("POST /api/master-changes/entries (マスタをまとめて保存)", () => {
  const load = () => import("../../app/api/master-changes/entries/route");
  const oneVehicleEdit = {
    edits: [{ targetKind: "vehicle", targetKey: "24", field: "lease", value: "3000" }],
  };

  it("入力担当は保存できない(1件ずつの入口と同じ権限にする)", async () => {
    sessionRef.current = staffSession;
    const { POST } = await load();
    const res = await POST(post("/api/master-changes/entries", oneVehicleEdit));
    expect(res.status).toBe(401);
    expect(mocks.writerWrite).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403", async () => {
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entries", oneVehicleEdit, { origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect(mocks.writerWrite).not.toHaveBeenCalled();
  });

  it("中身が読めない要求は400(壊れた本文で書き込みを走らせない)", async () => {
    const { POST } = await load();
    const broken = new Request("http://test/api/master-changes/entries", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: "{壊れている",
    });
    expect((await POST(broken)).status).toBe(400);
  });

  it("直す内容が空なら400", async () => {
    const { POST } = await load();
    expect((await POST(post("/api/master-changes/entries", { edits: [] }))).status).toBe(400);
    expect((await POST(post("/api/master-changes/entries", {}))).status).toBe(400);
  });

  /** 一度に大量に送られると、収支表の作り直しが終わらなくなる */
  it("500項目を超えたら受け取らない", async () => {
    const { POST } = await load();
    const edits = Array.from({ length: 501 }, () => ({
      targetKind: "vehicle",
      targetKey: "24",
      field: "lease",
      value: "1",
    }));
    const res = await POST(post("/api/master-changes/entries", { edits }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "一度に保存できるのは500項目までです" });
  });

  it("対象の種類や車番が無ければ、1項目も書かずに400", async () => {
    const { POST } = await load();
    const cases = [
      { targetKind: "rate", targetKey: "24", field: "lease", value: "1" },
      { targetKind: "vehicle", targetKey: "  ", field: "lease", value: "1" },
    ];
    for (const bad of cases) {
      const res = await POST(post("/api/master-changes/entries", { edits: [bad] }));
      expect(res.status).toBe(400);
    }
    expect(mocks.writerWrite).not.toHaveBeenCalled();
  });

  it("一覧に無い項目は直せない(任意の列を書き換えさせない)", async () => {
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entries", {
        edits: [{ targetKind: "vehicle", targetKey: "24", field: "vehicleNo", value: "99" }],
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "この項目は画面からは直せません" });
    expect(mocks.writerWrite).not.toHaveBeenCalled();
  });

  it("直す前の値を添えて履歴に渡す(何から何へ、が無いと元に戻せない)", async () => {
    const { POST } = await load();
    const res = await POST(post("/api/master-changes/entries", oneVehicleEdit));
    expect(res.status).toBe(200);
    const [arg] = mocks.applierExecute.mock.calls.at(-1) as [{ edits: unknown[] }];
    expect(arg.edits[0]).toMatchObject({
      targetKind: "vehicle",
      targetLabel: "車番 24",
      fieldLabel: "リース料",
      beforeValue: "1000",
      afterValue: "3000",
    });
    expect(await res.json()).toMatchObject({
      saved: 1,
      failures: [],
      applied: ["2026-05"],
      heldBack: ["2026-04"],
    });
  });

  it("運転者は氏名で示す(社員コードだけでは誰のことか分からない)", async () => {
    const { POST } = await load();
    await POST(
      post("/api/master-changes/entries", {
        edits: [{ targetKind: "driver", targetKey: "1002", field: "vehicleNo", value: "24" }],
      }),
    );
    const [arg] = mocks.applierExecute.mock.calls.at(-1) as [{ edits: unknown[] }];
    expect(arg.edits[0]).toMatchObject({
      targetLabel: "鈴木一郎",
      fieldLabel: "乗っている車",
      beforeValue: "300",
    });
  });

  it("元が空の項目は「変更前なし」として扱う", async () => {
    const { POST } = await load();
    await POST(
      post("/api/master-changes/entries", {
        edits: [{ targetKind: "vehicle", targetKey: "25", field: "vehicleType", value: "トレーラ" }],
      }),
    );
    const [arg] = mocks.applierExecute.mock.calls.at(-1) as [{ edits: unknown[] }];
    expect(arg.edits[0]).toMatchObject({ beforeValue: null, afterValue: "トレーラ" });
  });

  it("値が未指定なら空文字として保存する(欄を消す操作を潰さない)", async () => {
    const { POST } = await load();
    await POST(
      post("/api/master-changes/entries", {
        edits: [{ targetKind: "vehicle", targetKey: "24", field: "depot", value: null }],
      }),
    );
    expect(mocks.writerWrite).toHaveBeenCalledWith(
      expect.objectContaining({ field: "depot", value: "" }),
    );
  });

  /* ここからが「まとめて」だからこそ要る守り */

  it("マスタに無い対象は、その1件だけ失敗にして他は保存する", async () => {
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entries", {
        edits: [
          { targetKind: "vehicle", targetKey: "99", field: "lease", value: "1" },
          { targetKind: "driver", targetKey: "9999", field: "driverName", value: "誰か" },
          { targetKind: "vehicle", targetKey: "24", field: "lease", value: "3000" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      saved: 1,
      failures: [
        { targetKey: "99", field: "lease", message: "その車番が車両マスタにありません" },
        { targetKey: "9999", field: "driverName", message: "その社員Noが運転者マスタにありません" },
      ],
    });
    expect(mocks.writerWrite).toHaveBeenCalledTimes(1);
  });

  it("書き込みが1件こけても、残りは保存して欄ごとに理由を返す", async () => {
    mocks.writerWrite
      .mockRejectedValueOnce(new Error("数字で入れてください"))
      .mockResolvedValueOnce(undefined);
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entries", {
        edits: [
          { targetKind: "vehicle", targetKey: "24", field: "lease", value: "いくらか" },
          { targetKind: "vehicle", targetKey: "25", field: "lease", value: "3000" },
        ],
      }),
    );
    expect(await res.json()).toMatchObject({
      saved: 1,
      failures: [{ targetKey: "24", field: "lease", message: "数字で入れてください" }],
    });
  });

  it("DBの英語のエラーは、そのまま画面に出さない", async () => {
    mocks.writerWrite.mockRejectedValue(
      new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT"),
    );
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entries", {
        edits: [{ targetKind: "driver", targetKey: "1002", field: "vehicleNo", value: "999" }],
      }),
    );
    const body = (await res.json()) as { failures: { message: string }[] };
    expect(body.failures[0].message).not.toMatch(/D1_ERROR|SQLITE/);
    expect(body.failures[0].message).toContain("確かめてください");
  });

  it("理由の無い失敗でも、欄が空のままにならない", async () => {
    mocks.writerWrite.mockRejectedValue(new Error(""));
    const { POST } = await load();
    const res = await POST(post("/api/master-changes/entries", oneVehicleEdit));
    const body = (await res.json()) as { failures: { message: string }[] };
    expect(body.failures[0].message).toBe("保存できませんでした");
  });

  it("何項目直しても、収支表の作り直しは最後に1回だけ", async () => {
    const { POST } = await load();
    await POST(
      post("/api/master-changes/entries", {
        edits: [
          { targetKind: "vehicle", targetKey: "24", field: "lease", value: "1" },
          { targetKind: "vehicle", targetKey: "25", field: "lease", value: "2" },
          { targetKind: "driver", targetKey: "1002", field: "driverName", value: "鈴木 一郎" },
        ],
      }),
    );
    expect(mocks.writerWrite).toHaveBeenCalledTimes(3);
    expect(mocks.applierExecute).toHaveBeenCalledTimes(1);
  });

  it("1件も保存できなければ、収支表は作り直さない", async () => {
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entries", {
        edits: [{ targetKind: "vehicle", targetKey: "99", field: "lease", value: "1" }],
      }),
    );
    expect(await res.json()).toMatchObject({ saved: 0, applied: [], heldBack: [] });
    expect(mocks.applierExecute).not.toHaveBeenCalled();
  });
});

describe("POST /api/rate-master/entries (率をまとめて保存)", () => {
  const load = () => import("../../app/api/rate-master/entries/route");
  const oneRateEdit = {
    edits: [{ key: "admin_fee_rate", yearMonth: null, field: "admin_fee_rate", value: 0.2 }],
  };

  it("入力担当は保存できない", async () => {
    sessionRef.current = staffSession;
    const { POST } = await load();
    expect((await POST(post("/api/rate-master/entries", oneRateEdit))).status).toBe(401);
    expect(mocks.setRate).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403", async () => {
    const { POST } = await load();
    const res = await POST(
      post("/api/rate-master/entries", oneRateEdit, { origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect(mocks.setRate).not.toHaveBeenCalled();
  });

  it("直す内容が空なら400", async () => {
    const { POST } = await load();
    expect((await POST(post("/api/rate-master/entries", { edits: [] }))).status).toBe(400);
    expect((await POST(post("/api/rate-master/entries", {}))).status).toBe(400);
  });

  it("200項目を超えたら受け取らない", async () => {
    const { POST } = await load();
    const edits = Array.from({ length: 201 }, () => ({
      key: "admin_fee_rate",
      yearMonth: null,
      field: "f",
      value: 0.1,
    }));
    const res = await POST(post("/api/rate-master/entries", { edits }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "一度に保存できるのは200項目までです" });
  });

  it("知らないキーは受け取らない(任意の設定値を作らせない)", async () => {
    const { POST } = await load();
    const res = await POST(
      post("/api/rate-master/entries", {
        edits: [{ key: "勝手な項目", yearMonth: null, field: "f", value: 1 }],
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.setRate).not.toHaveBeenCalled();
  });

  it("年月の形が違えば受け取らない", async () => {
    const { POST } = await load();
    for (const bad of ["2026/05", "2026-13", "26-05"]) {
      const res = await POST(
        post("/api/rate-master/entries", {
          edits: [{ key: "bonus_annual", yearMonth: bad, field: "f", value: 1 }],
        }),
      );
      expect(res.status, bad).toBe(400);
    }
    expect(mocks.setRate).not.toHaveBeenCalled();
  });

  it("直す前の値を添えて履歴に渡す", async () => {
    const { POST } = await load();
    const res = await POST(post("/api/rate-master/entries", oneRateEdit));
    expect(res.status).toBe(200);
    expect(mocks.setRate).toHaveBeenCalledWith("admin_fee_rate", null, 0.2, "user-admin");
    const [arg] = mocks.applierExecute.mock.calls.at(-1) as [{ edits: unknown[] }];
    expect(arg.edits[0]).toMatchObject({
      targetKind: "rate",
      targetKey: "admin_fee_rate|",
      targetLabel: "一般管理費率",
      beforeValue: "0.1748",
      afterValue: "0.2",
    });
  });

  it("まだ登録の無い率は「変更前なし」として扱う", async () => {
    mocks.listRates.mockResolvedValue([]);
    const { POST } = await load();
    await POST(post("/api/rate-master/entries", oneRateEdit));
    const [arg] = mocks.applierExecute.mock.calls.at(-1) as [{ edits: unknown[] }];
    expect(arg.edits[0]).toMatchObject({ beforeValue: null });
  });

  /* 率は全車両に効くので、範囲の取り方を間違えると古い表が残る */
  it("同じ月の直しだけなら、その月だけ作り直す", async () => {
    const { POST } = await load();
    await POST(
      post("/api/rate-master/entries", {
        edits: [
          { key: "bonus_annual", yearMonth: "2026-05", field: "f", value: 1 },
          { key: "tank_price", yearMonth: "2026-05", field: "g", value: 2 },
        ],
      }),
    );
    const [arg] = mocks.applierExecute.mock.calls.at(-1) as [{ onlyYearMonth: string | null }];
    expect(arg.onlyYearMonth).toBe("2026-05");
  });

  it("月ありと全期間共通が混ざったら、広い方(未確定の全月)を作り直す", async () => {
    const { POST } = await load();
    await POST(
      post("/api/rate-master/entries", {
        edits: [
          { key: "bonus_annual", yearMonth: "2026-05", field: "f", value: 1 },
          { key: "admin_fee_rate", yearMonth: null, field: "g", value: 0.2 },
        ],
      }),
    );
    const [arg] = mocks.applierExecute.mock.calls.at(-1) as [{ onlyYearMonth: string | null }];
    expect(arg.onlyYearMonth).toBeNull();
  });

  it("入れられない値は、その欄だけ理由を返して他は保存する", async () => {
    const { POST } = await load();
    const res = await POST(
      post("/api/rate-master/entries", {
        edits: [
          // 率は0〜1。17.48%のつもりで17.48と入れる打ち間違いを止める
          { key: "admin_fee_rate", yearMonth: null, field: "admin_fee_rate", value: 17.48 },
          { key: "bonus_annual", yearMonth: null, field: "bonus_annual", value: -1 },
          { key: "tank_price", yearMonth: null, field: "tank_price", value: "文字" },
          { key: "bonus_annual", yearMonth: "2026-05", field: "bonus_05", value: 600000 },
        ],
      }),
    );
    const body = (await res.json()) as { saved: number; failures: { message: string }[] };
    expect(body.saved).toBe(1);
    expect(body.failures.map((f) => f.message)).toEqual([
      "率は0〜1で入力してください(17.48%なら0.1748)",
      "0以上の値を入力してください",
      "数値を入力してください",
    ]);
    expect(mocks.setRate).toHaveBeenCalledTimes(1);
  });

  it("書き込みがこけても、欄ごとに理由を返す", async () => {
    mocks.setRate.mockRejectedValueOnce(new Error("書き込めませんでした"));
    const { POST } = await load();
    const res = await POST(post("/api/rate-master/entries", oneRateEdit));
    expect(await res.json()).toMatchObject({
      saved: 0,
      failures: [{ targetKey: "admin_fee_rate", message: "書き込めませんでした" }],
    });
    expect(mocks.applierExecute).not.toHaveBeenCalled();
  });

  it("理由の無い失敗でも、欄が空のままにならない", async () => {
    mocks.setRate.mockRejectedValueOnce("文字列で投げられた");
    const { POST } = await load();
    const res = await POST(post("/api/rate-master/entries", oneRateEdit));
    const body = (await res.json()) as { failures: { message: string }[] };
    expect(body.failures[0].message).toBe("保存できませんでした");
  });

  it("何項目直しても、収支表の作り直しは最後に1回だけ", async () => {
    const { POST } = await load();
    await POST(
      post("/api/rate-master/entries", {
        edits: [
          { key: "admin_fee_rate", yearMonth: null, field: "a", value: 0.2 },
          { key: "bonus_annual", yearMonth: null, field: "b", value: 1 },
          { key: "tank_price", yearMonth: null, field: "c", value: 2 },
        ],
      }),
    );
    expect(mocks.setRate).toHaveBeenCalledTimes(3);
    expect(mocks.applierExecute).toHaveBeenCalledTimes(1);
  });
});
