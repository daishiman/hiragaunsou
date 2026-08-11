import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";
import type { CleansingDecisionRecord } from "../../src/domain/repositories/CleansingDecisionRepository";

/**
 * /api/cleansing (STEP2 データ整形) のRoute Handlerを検証する。
 *
 * このルートは「元データを書き換えず判断だけを別テーブルへ残す」設計なので、
 * POSTが受け取った入力をどう CleansingDecisionRecord へ正規化するか(空rowKeyの読み飛ばし、
 * 不正な判断値の拒否、空文字→null 変換)が実質的なロジックの中心になる。
 * UseCase自体のロジックは tests/usecase 側で検証済みのため、
 * ここではリポジトリだけを差し替えて Route Handler + UseCase の配線を通しで確かめる。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const adminSession: SessionUser = {
  id: "user-admin",
  email: "imanishi@example.co.jp",
  name: "今西",
  role: "admin",
};
const executiveSession: SessionUser = {
  id: "user-exec",
  email: "exec@example.co.jp",
  name: "社長",
  role: "executive",
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

const { findRawRowsMock, findLatestBatchMock } = vi.hoisted(() => ({
  findRawRowsMock: vi.fn(),
  findLatestBatchMock: vi.fn(),
}));
vi.mock("../../src/infrastructure/db/D1ImportBatchRepository", () => ({
  D1ImportBatchRepository: class {
    findRawRows = findRawRowsMock;
    findLatestBatch = findLatestBatchMock;
  },
}));

const { findByYearMonthMock, findPreviousDecisionsMock, upsertManyMock } = vi.hoisted(() => ({
  findByYearMonthMock: vi.fn(),
  findPreviousDecisionsMock: vi.fn(),
  upsertManyMock: vi.fn(),
}));
vi.mock("../../src/infrastructure/db/D1CleansingDecisionRepository", () => ({
  D1CleansingDecisionRepository: class {
    findByYearMonth = findByYearMonthMock;
    findPreviousDecisions = findPreviousDecisionsMock;
    upsertMany = upsertManyMock;
  },
}));

/** 売上モニタリストの実データ形状に合わせた行を作る */
function salesRow(over: Record<string, unknown>) {
  return {
    naturalKey: null,
    flags: [],
    raw: {
      vehicleCode: "4242",
      driverName: "山田",
      fare: 10000,
      toll: 0,
      ancillaryFee: 0,
      isChartered: false,
      needsReview: false,
      reviewReason: null,
      slipNo: "S-001",
      lineNo: "1",
      customerName: "東洋インキ㈱",
      loadDate: "2026-05-01",
      ...over,
    },
  };
}

function postCleansing(body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return import("../../app/api/cleansing/route").then(({ POST }) =>
    POST(
      new Request("http://test/api/cleansing", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

beforeEach(() => {
  sessionRef.current = adminSession;
  findRawRowsMock.mockReset().mockResolvedValue([]);
  findLatestBatchMock.mockReset().mockResolvedValue(null);
  findByYearMonthMock.mockReset().mockResolvedValue([]);
  findPreviousDecisionsMock.mockReset().mockResolvedValue([]);
  upsertManyMock.mockReset().mockResolvedValue(undefined);
});

describe("GET /api/cleansing", () => {
  it("未ログインなら401(D1に触れずに弾く)", async () => {
    sessionRef.current = null;
    const { GET } = await import("../../app/api/cleansing/route");
    const res = await GET(new Request("http://test/api/cleansing?yearMonth=2026-05"));
    expect(res.status).toBe(401);
    expect(findRawRowsMock).not.toHaveBeenCalled();
  });

  it("既知のロールに無い値ならview権限が無いものとして401", async () => {
    sessionRef.current = { ...adminSession, role: "unknown" };
    const { GET } = await import("../../app/api/cleansing/route");
    const res = await GET(new Request("http://test/api/cleansing?yearMonth=2026-05"));
    expect(res.status).toBe(401);
  });

  it("yearMonthが無ければ400", async () => {
    const { GET } = await import("../../app/api/cleansing/route");
    const res = await GET(new Request("http://test/api/cleansing"));
    expect(res.status).toBe(400);
    expect(findRawRowsMock).not.toHaveBeenCalled();
  });

  it("要判断の伝票だけを返し、判断済みは後ろに回る", async () => {
    findRawRowsMock.mockResolvedValue([
      // 諸口 → 要判断
      salesRow({ slipNo: "S-100", driverName: "諸口", fare: 30000 }),
      // 2重計上の実績がある車番888 → 要判断
      salesRow({ slipNo: "S-200", vehicleCode: "888", fare: 50000 }),
      // フラグ無し → 判断リストに出ない
      salesRow({ slipNo: "S-300" }),
    ]);
    findLatestBatchMock.mockResolvedValue({
      id: "b1",
      fileName: "売上モニタリスト.xlsx",
      rowCount: 3,
      excludedRowCount: 7,
      importedAt: 0,
    });
    findByYearMonthMock.mockResolvedValue([
      {
        yearMonth: "2026-05",
        sourceType: "sales_monitor",
        rowKey: "S-200-1",
        vehicleNo: "888",
        driverName: "山田",
        flagTypes: ["duplicate_suspect"],
        decision: "delete",
        correctedVehicleNo: null,
        note: null,
      } satisfies CleansingDecisionRecord,
    ]);

    const { GET } = await import("../../app/api/cleansing/route");
    const res = await GET(new Request("http://test/api/cleansing?yearMonth=2026-05"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      items: { rowKey: string; decision: string | null }[];
      totalRows: number;
      charteredExcluded: number;
      pendingCount: number;
      excludedCount: number;
      notImported: boolean;
    };
    expect(body.notImported).toBe(false);
    expect(body.totalRows).toBe(3);
    expect(body.charteredExcluded).toBe(7);
    // フラグ無しのS-300は要判断リストに出ない
    expect(body.items.map((i) => i.rowKey)).toEqual(["S-100-1", "S-200-1"]);
    // 未判断が先頭に来る
    expect(body.items[0].decision).toBeNull();
    expect(body.pendingCount).toBe(1);
    expect(body.excludedCount).toBe(1);
    expect(findRawRowsMock).toHaveBeenCalledWith("2026-05", "sales_monitor");
  });

  it("売上モニタリストが未取込なら notImported=true(空リストと区別する)", async () => {
    findRawRowsMock.mockResolvedValue([]);
    const { GET } = await import("../../app/api/cleansing/route");
    const res = await GET(new Request("http://test/api/cleansing?yearMonth=2026-05"));
    const body = (await res.json()) as { notImported: boolean; items: unknown[] };
    expect(body.notImported).toBe(true);
    expect(body.items).toEqual([]);
  });
});

describe("POST /api/cleansing", () => {
  it("input権限の無い社長ロールは401", async () => {
    sessionRef.current = executiveSession;
    const res = await postCleansing({ yearMonth: "2026-05", decisions: [] });
    expect(res.status).toBe(401);
    expect(upsertManyMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const res = await postCleansing({ yearMonth: "2026-05", decisions: [] }, {
      origin: "https://evil.example.com",
    });
    expect(res.status).toBe(403);
  });

  it("Originヘッダーが無ければ403(ブラウザ外からの呼び出しとみなす)", async () => {
    const res = await postCleansing({ yearMonth: "2026-05", decisions: [] }, {});
    expect(res.status).toBe(403);
  });

  it("yearMonthが無ければ400", async () => {
    const res = await postCleansing({ decisions: [] });
    expect(res.status).toBe(400);
  });

  it("decisionsが配列でなければ400", async () => {
    const res = await postCleansing({ yearMonth: "2026-05", decisions: { a: 1 } });
    expect(res.status).toBe(400);
  });

  it("JSONとして壊れているbodyは400", async () => {
    const { POST } = await import("../../app/api/cleansing/route");
    const res = await POST(
      new Request("http://test/api/cleansing", {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: "{壊れたJSON",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("VALID_DECISIONS に無い判断は400で、受け取った値をメッセージに含める", async () => {
    const res = await postCleansing({
      yearMonth: "2026-05",
      decisions: [{ rowKey: "S-100-1", decision: "merge" }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("merge");
    expect(upsertManyMock).not.toHaveBeenCalled();
  });

  it("rowKeyが空文字・空白だけの行は判断値を検証せず読み飛ばす", async () => {
    const res = await postCleansing({
      yearMonth: "2026-05",
      decisions: [
        { rowKey: "", decision: "不正な値でも読み飛ばされる" },
        { rowKey: "   ", decision: "keep" },
        { rowKey: " S-100-1 ", decision: "keep" },
      ],
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ yearMonth: "2026-05", saved: 1 });

    const [records] = upsertManyMock.mock.calls[0] as [CleansingDecisionRecord[]];
    expect(records).toHaveLength(1);
    expect(records[0].rowKey).toBe("S-100-1");
  });

  it("空配列でも200を返し、何も保存しない(判断の全解除は正常な操作)", async () => {
    const res = await postCleansing({ yearMonth: "2026-05", decisions: [] });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ yearMonth: "2026-05", saved: 0 });
    expect(upsertManyMock).toHaveBeenCalledWith([], adminSession.id);
  });

  it("空文字の付け替え先・備考はnullに正規化し、flagTypesが配列でなければ空配列にする", async () => {
    const res = await postCleansing({
      yearMonth: "2026-05",
      decisions: [
        {
          rowKey: "S-100-1",
          vehicleNo: "888",
          driverName: "諸口",
          flagTypes: "misc_entry",
          decision: "correct",
          correctedVehicleNo: "  4242  ",
          note: "   ",
        },
        {
          rowKey: "S-200-1",
          flagTypes: ["duplicate_suspect"],
          decision: "delete",
          correctedVehicleNo: "   ",
          note: "請求書担当に確認済み",
        },
      ],
    });
    expect(res.status).toBe(200);

    const [records, decidedBy] = upsertManyMock.mock.calls[0] as [
      CleansingDecisionRecord[],
      string,
    ];
    expect(decidedBy).toBe(adminSession.id);
    expect(records[0]).toEqual({
      yearMonth: "2026-05",
      sourceType: "sales_monitor",
      rowKey: "S-100-1",
      vehicleNo: "888",
      driverName: "諸口",
      flagTypes: [],
      decision: "correct",
      correctedVehicleNo: "4242",
      note: null,
    });
    expect(records[1]).toEqual({
      yearMonth: "2026-05",
      sourceType: "sales_monitor",
      rowKey: "S-200-1",
      vehicleNo: null,
      driverName: null,
      flagTypes: ["duplicate_suspect"],
      decision: "delete",
      correctedVehicleNo: null,
      note: "請求書担当に確認済み",
    });
  });

  it("保存に失敗したら500で例外のメッセージをそのまま返す", async () => {
    upsertManyMock.mockRejectedValue(new Error("D1_ERROR: no such table"));
    const res = await postCleansing({
      yearMonth: "2026-05",
      decisions: [{ rowKey: "S-100-1", decision: "keep" }],
    });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: "D1_ERROR: no such table" });
  });

  it("Error以外がthrowされても500で既定メッセージを返す", async () => {
    upsertManyMock.mockRejectedValue("文字列のthrow");
    const res = await postCleansing({
      yearMonth: "2026-05",
      decisions: [{ rowKey: "S-100-1", decision: "keep" }],
    });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: "判定の保存に失敗しました" });
  });
});
