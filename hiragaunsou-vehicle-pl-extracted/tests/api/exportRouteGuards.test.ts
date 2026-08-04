import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "../../src/infrastructure/auth/session";
import { VEHICLE_PL_FIELDS } from "../../src/domain/entities/VehiclePl";

/**
 * /api/export (STEP8 収支表のCSV書き出し) のRoute Handlerを検証する。
 *
 * このルートの成果物はExcelへ貼り付ける前提のファイルなので、
 * 「51列の並びが収支表と同じか」「Excelが文字化けせず開けるか(BOM/CRLF)」
 * 「日本語ファイル名がダウンロード時に壊れないか」までが仕様の一部になる。
 * NextResponse.json ではなく生の Response を返す唯一の分岐でもあるため、
 * ヘッダーと本文の両方を実物のCSVビルダーを通して確かめる。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const execSession: SessionUser = {
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

const { findByYearMonthMock } = vi.hoisted(() => ({ findByYearMonthMock: vi.fn() }));
vi.mock("../../src/infrastructure/db/D1VehiclePlRepository", () => ({
  D1VehiclePlRepository: class {
    findByYearMonth = findByYearMonthMock;
  },
}));

function getExport(url: string) {
  return import("../../app/api/export/route").then(({ GET }) => GET(new Request(url)));
}

/** CSV本文を BOM を外して行に割る */
function csvLines(text: string): string[] {
  // Response.text() のデコードでBOMは既に落ちているが、念のため残っていても外す
  return text.replace(/^\uFEFF/, "").replace(/\r\n$/, "").split("\r\n");
}

beforeEach(() => {
  sessionRef.current = execSession;
  findByYearMonthMock.mockReset().mockResolvedValue([]);
});

describe("GET /api/export のガード", () => {
  it("未ログインなら401(D1に触れない)", async () => {
    sessionRef.current = null;
    const res = await getExport("http://test/api/export?yearMonth=2026-05");
    expect(res.status).toBe(401);
    expect(findByYearMonthMock).not.toHaveBeenCalled();
  });

  it("既知のロールに無い値ならview権限が無いものとして401", async () => {
    sessionRef.current = { ...execSession, role: "" };
    const res = await getExport("http://test/api/export?yearMonth=2026-05");
    expect(res.status).toBe(401);
  });

  it("yearMonthが無ければ400", async () => {
    const res = await getExport("http://test/api/export");
    expect(res.status).toBe(400);
    expect(findByYearMonthMock).not.toHaveBeenCalled();
  });

  it("yearMonthが空文字なら400(パラメータ有りでも中身が無ければ拒否)", async () => {
    const res = await getExport("http://test/api/export?yearMonth=");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/export のCSV出力", () => {
  it("Excelで開ける形式(BOM付き・CRLF)で収支表51列を書き出す", async () => {
    findByYearMonthMock.mockResolvedValue([
      { no: "4242", driver: "山田", sales: 1234567, profit: -50000, margin: -0.0405 },
      { no: "888", driver: "諸口", sales: 0, profit: 0, margin: 0 },
    ]);

    const res = await getExport("http://test/api/export?yearMonth=2026-05");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");

    // res.text() はデコード時にBOMを取り除いてしまうので、バイト列で確認する
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const text = await res.text();
    expect(text.endsWith("\r\n")).toBe(true);

    const lines = csvLines(text);
    expect(lines).toHaveLength(3);
    // 見出しは日本語ラベルで、列数は収支表の定義と一致する
    expect(lines[0].split(",")).toHaveLength(VEHICLE_PL_FIELDS.length);
    expect(lines[0].startsWith("車番,車種名,所属")).toBe(true);
    // 値の入っていない列は空欄になり、列位置はずれない
    expect(lines[1].split(",")).toHaveLength(VEHICLE_PL_FIELDS.length);
    expect(lines[1].startsWith("4242,,,,,山田,")).toBe(true);
    expect(lines[1]).toContain("1234567");
    expect(lines[2].startsWith("888,,,,,諸口,")).toBe(true);

    expect(findByYearMonthMock).toHaveBeenCalledWith("2026-05");
  });

  it("収支表が0件でも見出し行だけのCSVを返す(空ファイルにしない)", async () => {
    findByYearMonthMock.mockResolvedValue([]);
    const res = await getExport("http://test/api/export?yearMonth=2026-05");
    expect(res.status).toBe(200);
    expect(csvLines(await res.text())).toHaveLength(1);
  });

  it("カンマや引用符を含む値はRFC4180どおりに囲って列崩れを防ぐ", async () => {
    findByYearMonthMock.mockResolvedValue([
      { no: "4242", type: '大型, ウイング"新"', driver: "山田" },
    ]);
    const res = await getExport("http://test/api/export?yearMonth=2026-05");
    const line = csvLines(await res.text())[1];
    expect(line).toContain('"大型, ウイング""新"""');
    // 囲ったことで列数が増えていない
    expect(line.match(/,/g)?.length).toBeGreaterThanOrEqual(VEHICLE_PL_FIELDS.length - 1);
  });

  it("日本語ファイル名はRFC5987形式でエンコードして渡す", async () => {
    const res = await getExport("http://test/api/export?yearMonth=2026-05");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition.startsWith("attachment; filename*=UTF-8''")).toBe(true);
    expect(decodeURIComponent(disposition.split("UTF-8''")[1])).toBe("車両別収支表_2026年5月.csv");
  });

  it("1桁月は先頭0を落としたファイル名にする(業務で使う言い方に合わせる)", async () => {
    const res = await getExport("http://test/api/export?yearMonth=2026-01");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(decodeURIComponent(disposition.split("UTF-8''")[1])).toBe("車両別収支表_2026年1月.csv");
  });
});
