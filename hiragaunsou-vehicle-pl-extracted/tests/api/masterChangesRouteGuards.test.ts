import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";

/**
 * マスタの直しと反映まわりの Route Handler を検証する。
 *
 * ここで守りたいのは
 *   1. 収支表の土台を動かす操作なので、管理者以外は通さないこと (CSRF防御も含む)
 *   2. 対象の指定が無いまま反映・取り消しが走らないこと
 *   3. DBが返す英語のエラーを、そのまま画面に出さないこと
 * の3点。反映の中身の正しさは tests/usecase 側で見ている。
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
  statusExecute: vi.fn(),
  writerWrite: vi.fn(),
  applierExecute: vi.fn(),
  applyToConfirmedExecute: vi.fn(),
  revertExecute: vi.fn(),
  undoExecute: vi.fn(),
  detectExecute: vi.fn(),
  ack: vi.fn(),
  unack: vi.fn(),
  findAllActive: vi.fn(),
  findAllDrivers: vi.fn(),
}));

vi.mock("../../app/_lib/masterChangeStack", () => ({
  masterChangeStack: () => ({
    status: { execute: mocks.statusExecute },
    writer: { write: mocks.writerWrite },
    applier: { execute: mocks.applierExecute },
    applyToConfirmed: { execute: mocks.applyToConfirmedExecute },
    revert: { execute: mocks.revertExecute },
    undo: { execute: mocks.undoExecute },
  }),
  importDiffDetector: () => ({ execute: mocks.detectExecute }),
  importDiffAckRepository: () => ({ ack: mocks.ack, unack: mocks.unack }),
}));

vi.mock("../../src/infrastructure/db/D1MasterRepository", () => ({
  D1VehicleMasterRepository: class {
    findAllActive = mocks.findAllActive;
  },
  D1DriverMasterRepository: class {
    findAll = mocks.findAllDrivers;
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
  mocks.statusExecute.mockResolvedValue({ months: [], history: [], applies: [] });
  mocks.writerWrite.mockResolvedValue(undefined);
  mocks.applierExecute.mockResolvedValue({
    appliedYearMonths: ["2026-05"],
    applied: [{ yearMonth: "2026-05", vehicleCount: 3 }],
    heldBackYearMonths: ["2026-04"],
  });
  mocks.applyToConfirmedExecute.mockResolvedValue({
    applyId: "ap1",
    summary: { vehicleCount: 3 },
  });
  mocks.revertExecute.mockResolvedValue({ yearMonth: "2026-04", vehicleCount: 3 });
  mocks.undoExecute.mockResolvedValue({
    record: { targetLabel: "車番 24", fieldLabel: "リース料", beforeValue: "1000" },
    result: { appliedYearMonths: ["2026-05"], heldBackYearMonths: [] },
  });
  mocks.detectExecute.mockResolvedValue({ diffs: [] });
  mocks.findAllActive.mockResolvedValue([{ vehicleNo: "24", lease: 1000 }]);
  mocks.findAllDrivers.mockResolvedValue([
    { employeeCode: "1002", driverName: "鈴木一郎", vehicleNo: "300" },
  ]);
});

describe("GET /api/master-changes", () => {
  it("入力担当は開けない(直せない人に食い違いの一覧は出さない)", async () => {
    sessionRef.current = staffSession;
    const { GET } = await import("../../app/api/master-changes/route");
    expect((await GET()).status).toBe(401);
  });

  it("管理者には据え置いた月の一覧を返す", async () => {
    const { GET } = await import("../../app/api/master-changes/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ months: [] });
  });

  it("読み取りに失敗しても、画面が開けるように理由を返す", async () => {
    mocks.statusExecute.mockRejectedValue(new Error("読めませんでした"));
    const { GET } = await import("../../app/api/master-changes/route");
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "読めませんでした" });
  });
});

describe("POST /api/master-changes/apply", () => {
  it("未ログインなら401", async () => {
    sessionRef.current = null;
    const { POST } = await import("../../app/api/master-changes/apply/route");
    const res = await POST(post("/api/master-changes/apply", { yearMonths: ["2026-04"] }));
    expect(res.status).toBe(401);
    expect(mocks.applyToConfirmedExecute).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403", async () => {
    const { POST } = await import("../../app/api/master-changes/apply/route");
    const res = await POST(
      post("/api/master-changes/apply", { yearMonths: ["2026-04"] }, { origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect(mocks.applyToConfirmedExecute).not.toHaveBeenCalled();
  });

  it("月の指定が無ければ400(どこに反映するか分からないまま走らせない)", async () => {
    const { POST } = await import("../../app/api/master-changes/apply/route");
    const res = await POST(post("/api/master-changes/apply", { yearMonths: ["2026/04", 5] }));
    expect(res.status).toBe(400);
    expect(mocks.applyToConfirmedExecute).not.toHaveBeenCalled();
  });

  it("まとめて反映しても1月ずつ記録が残る", async () => {
    mocks.applyToConfirmedExecute
      .mockResolvedValueOnce({ applyId: "a1", summary: { vehicleCount: 3 } })
      .mockResolvedValueOnce({ applyId: "a2", summary: { vehicleCount: 4 } });
    const { POST } = await import("../../app/api/master-changes/apply/route");
    const res = await POST(post("/api/master-changes/apply", { yearMonths: ["2026-03", "2026-04"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      applied: [
        { yearMonth: "2026-03", applyId: "a1", vehicleCount: 3 },
        { yearMonth: "2026-04", applyId: "a2", vehicleCount: 4 },
      ],
    });
  });

  /** 途中で失敗しても、成功した月まで巻き戻すと理由なく数字が動いて見える */
  it("途中で失敗したら、そこで止めて成功した月を返す", async () => {
    mocks.applyToConfirmedExecute
      .mockResolvedValueOnce({ applyId: "a1", summary: { vehicleCount: 3 } })
      .mockRejectedValueOnce(new Error("元データがありません"));
    const { POST } = await import("../../app/api/master-changes/apply/route");
    const res = await POST(post("/api/master-changes/apply", { yearMonths: ["2026-03", "2026-04"] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      applied: [{ yearMonth: "2026-03", applyId: "a1", vehicleCount: 3 }],
      error: "2026-04: 元データがありません",
    });
  });
});

describe("POST /api/master-changes/undo", () => {
  it("入力担当は元に戻せない", async () => {
    sessionRef.current = staffSession;
    const { POST } = await import("../../app/api/master-changes/undo/route");
    const res = await POST(post("/api/master-changes/undo", { editId: "e1" }));
    expect(res.status).toBe(401);
  });

  it("Originが一致しなければ403", async () => {
    const { POST } = await import("../../app/api/master-changes/undo/route");
    const res = await POST(
      post("/api/master-changes/undo", { editId: "e1" }, { origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
  });

  it("対象の指定が無ければ400", async () => {
    const { POST } = await import("../../app/api/master-changes/undo/route");
    const res = await POST(post("/api/master-changes/undo", { editId: "" }));
    expect(res.status).toBe(400);
    expect(mocks.undoExecute).not.toHaveBeenCalled();
    expect(mocks.revertExecute).not.toHaveBeenCalled();
  });

  it("applyId を渡すと、その月を反映前の収支表に戻す", async () => {
    const { POST } = await import("../../app/api/master-changes/undo/route");
    const res = await POST(post("/api/master-changes/undo", { applyId: "ap1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "apply", yearMonth: "2026-04" });
    expect(mocks.undoExecute).not.toHaveBeenCalled();
  });

  it("editId を渡すと、直す前の値に戻して何に戻したかを返す", async () => {
    const { POST } = await import("../../app/api/master-changes/undo/route");
    const res = await POST(post("/api/master-changes/undo", { editId: "e1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      kind: "edit",
      targetLabel: "車番 24",
      fieldLabel: "リース料",
      restoredValue: "1000",
      applied: ["2026-05"],
    });
  });

  it("戻せなかった理由を画面に返す", async () => {
    mocks.undoExecute.mockRejectedValue(new Error("この記録は見つかりません"));
    const { POST } = await import("../../app/api/master-changes/undo/route");
    const res = await POST(post("/api/master-changes/undo", { editId: "e1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "この記録は見つかりません" });
  });
});

describe("POST /api/master-changes/entry (1件だけ直す)", () => {
  const load = () => import("../../app/api/master-changes/entry/route");

  it("入力担当は直せない", async () => {
    sessionRef.current = staffSession;
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entry", {
        targetKind: "vehicle",
        targetKey: "24",
        field: "lease",
        value: "2000",
      }),
    );
    expect(res.status).toBe(401);
    expect(mocks.writerWrite).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403", async () => {
    const { POST } = await load();
    const res = await POST(
      post(
        "/api/master-changes/entry",
        { targetKind: "vehicle", targetKey: "24", field: "lease", value: "2000" },
        { origin: "https://evil.example" },
      ),
    );
    expect(res.status).toBe(403);
  });

  it("対象の種類が分からなければ400", async () => {
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entry", { targetKind: "rate", targetKey: "x", field: "lease" }),
    );
    expect(res.status).toBe(400);
  });

  it("一覧に無い項目は直せない(任意の列を書き換えさせない)", async () => {
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entry", {
        targetKind: "vehicle",
        targetKey: "24",
        field: "vehicleNo",
        value: "99",
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.writerWrite).not.toHaveBeenCalled();
  });

  it("マスタに無い車番なら、書く前に止める", async () => {
    mocks.findAllActive.mockResolvedValue([]);
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entry", {
        targetKind: "vehicle",
        targetKey: "24",
        field: "lease",
        value: "2000",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "その車番が車両マスタにありません" });
    expect(mocks.writerWrite).not.toHaveBeenCalled();
  });

  it("マスタに無い社員コードなら、書く前に止める", async () => {
    mocks.findAllDrivers.mockResolvedValue([]);
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entry", {
        targetKind: "driver",
        targetKey: "1002",
        field: "driverName",
        value: "鈴木 一郎",
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.writerWrite).not.toHaveBeenCalled();
  });

  /** 直す前の値を控えないと履歴が「何から何へ」を示せず、元に戻せなくなる */
  it("車両を直すと、直す前の値を添えて履歴に渡す", async () => {
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entry", {
        targetKind: "vehicle",
        targetKey: "24",
        field: "lease",
        value: "2000",
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.writerWrite).toHaveBeenCalledWith({
      targetKind: "vehicle",
      targetKey: "24",
      field: "lease",
      value: "2000",
    });
    const [arg] = mocks.applierExecute.mock.calls.at(-1) as [
      { edits: { targetLabel: string; fieldLabel: string; beforeValue: string | null }[] },
    ];
    expect(arg.edits[0]).toMatchObject({
      targetLabel: "車番 24",
      fieldLabel: "リース料",
      beforeValue: "1000",
      afterValue: "2000",
    });
    expect(await res.json()).toMatchObject({ applied: ["2026-05"], heldBack: ["2026-04"] });
  });

  it("運転者は氏名で示す(社員コードだけでは誰のことか分からない)", async () => {
    const { POST } = await load();
    await POST(
      post("/api/master-changes/entry", {
        targetKind: "driver",
        targetKey: "1002",
        field: "vehicleNo",
        value: "24",
      }),
    );
    const [arg] = mocks.applierExecute.mock.calls.at(-1) as [
      { edits: { targetLabel: string; fieldLabel: string }[] },
    ];
    expect(arg.edits[0]).toMatchObject({ targetLabel: "鈴木一郎", fieldLabel: "乗っている車" });
  });

  /*
    2026-08-09: 車両マスタに無い車番を運転者に付けようとしたとき、DBの
    "D1_ERROR: FOREIGN KEY constraint failed" がそのまま画面に出ていた。
    読んだ人は何を直せばいいのか分からないので、言葉に置き換えて返す。
  */
  it("DBの英語のエラーは、そのまま画面に出さない", async () => {
    mocks.writerWrite.mockRejectedValue(
      new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT"),
    );
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entry", {
        targetKind: "driver",
        targetKey: "1002",
        field: "vehicleNo",
        value: "999",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/D1_ERROR|SQLITE/);
    expect(body.error).toContain("保存できませんでした");
  });

  it("言葉で書かれた理由はそのまま画面に出す", async () => {
    mocks.writerWrite.mockRejectedValue(new Error("数字で入れてください"));
    const { POST } = await load();
    const res = await POST(
      post("/api/master-changes/entry", {
        targetKind: "vehicle",
        targetKey: "24",
        field: "lease",
        value: "いくらか",
      }),
    );
    expect(await res.json()).toMatchObject({ error: "数字で入れてください" });
  });
});

describe("/api/import-diffs (前回と異なります)", () => {
  it("入力担当も読める(気づくのは入力する人のほうが早い)", async () => {
    sessionRef.current = staffSession;
    const { GET } = await import("../../app/api/import-diffs/route");
    const res = await GET();
    expect(res.status).toBe(200);
    // 読むだけのときは比較用の写しを書き換えない
    expect(mocks.detectExecute).toHaveBeenCalledWith({ persist: false });
  });

  it("閲覧のみのロールには返さない", async () => {
    sessionRef.current = { id: "u", email: "e@x.jp", name: "社長", role: "executive" };
    const { GET } = await import("../../app/api/import-diffs/route");
    expect((await GET()).status).toBe(401);
  });

  it("確認済みにできるのは管理者だけ(判断を伴う操作)", async () => {
    sessionRef.current = staffSession;
    const { POST } = await import("../../app/api/import-diffs/route");
    const res = await POST(post("/api/import-diffs", { fingerprints: ["f1"] }));
    expect(res.status).toBe(401);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it("対象が無ければ400", async () => {
    const { POST } = await import("../../app/api/import-diffs/route");
    const res = await POST(post("/api/import-diffs", { fingerprints: [] }));
    expect(res.status).toBe(400);
  });

  it("まとめて確認済みにできる", async () => {
    const { POST } = await import("../../app/api/import-diffs/route");
    const res = await POST(
      post("/api/import-diffs", {
        fingerprints: ["f1", "f2"],
        targetKind: "driver",
        targetLabel: "鈴木一郎",
        summary: "車番: 300 → 24",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2, undo: false });
    expect(mocks.ack).toHaveBeenCalledTimes(2);
    expect(mocks.ack.mock.calls[0][0]).toMatchObject({
      fingerprint: "f1",
      targetLabel: "鈴木一郎",
      actor: { id: "user-admin", name: "今西" },
    });
  });

  it("確認済みを取り消せる(押し間違いを戻せる)", async () => {
    const { POST } = await import("../../app/api/import-diffs/route");
    const res = await POST(post("/api/import-diffs", { fingerprints: ["f1"], undo: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1, undo: true });
    expect(mocks.unack).toHaveBeenCalledWith("f1");
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it("読み取りに失敗しても、取込の画面自体は開けるように理由を返す", async () => {
    mocks.detectExecute.mockRejectedValue(new Error("写しが読めません"));
    const { GET } = await import("../../app/api/import-diffs/route");
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "写しが読めません" });
  });
});
