import { describe, expect, it, vi, beforeEach } from "vitest";
import Encoding from "encoding-japanese";
import type { FileImportVerdict } from "../../src/domain/rules/fileImportCheck";

/**
 * POST /api/import/detect(取込前の下読み)。
 *
 * 「ファイル名を見ずに中身で判定し、食い違いは取込前に画面で知らせる」という共通仕様
 * (docs/product/file-import-common-spec.md)の入口。ここが黙って通してしまうと、
 * 別の帳票・別の月を無言で取り込む事故になるため、判定結果の形をここで固定する。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const { getServerSessionMock } = vi.hoisted(() => ({ getServerSessionMock: vi.fn() }));
vi.mock("../../src/infrastructure/auth/session", () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({ env: { DB: {}, BETTER_AUTH_URL: ORIGIN } })),
}));

vi.mock("../../src/infrastructure/db/client", () => ({ createDb: vi.fn(() => ({})) }));

const { findDuplicateMock } = vi.hoisted(() => ({ findDuplicateMock: vi.fn() }));
vi.mock("../../src/infrastructure/db/D1FileImportLogRepository", () => ({
  D1FileImportLogRepository: class {
    findDuplicate = findDuplicateMock;
  },
}));

interface DetectBody {
  sourceType: string;
  sourceLabel: string | null;
  contentHash: string;
  rowCount: number | null;
  yearMonth: string | null;
  basis: string;
  candidates: string[];
  verdict: FileImportVerdict;
}

function cp932(text: string): Uint8Array {
  return new Uint8Array(Encoding.convert(Encoding.stringToCode(text), { to: "SJIS", from: "UNICODE" }));
}

const SALES_MONITOR_HEADER =
  "車両コード,運転者名,受取運賃,通行料,燃料サーチャージ,待機時間料,付帯料金,管理№,行№,荷主先略称,積荷日";

function salesMonitorCsv(loadDates: string[]): string {
  const lines = loadDates.map((d, i) => `10${i},運転者${i},1000,200,0,0,0,S00${i},1,テスト荷主,${d}`);
  return [SALES_MONITOR_HEADER, ...lines].join("\n");
}

/** 判定の種類だけを取り出す(文言は画面側の責務)。 */
function kindsOf(verdict: FileImportVerdict): string[] {
  return verdict.issues.map((issue) => issue.kind);
}

function csvFile(name: string, text: string): File {
  return new File([cp932(text)], name, { type: "text/csv" });
}

async function detect(
  file: File,
  fields: Record<string, string> = {},
  origin: string | null = ORIGIN,
): Promise<Response> {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const request = new Request("http://test/api/import/detect", {
    method: "POST",
    headers: origin ? { origin } : {},
  });
  request.formData = async () => form;
  const { POST } = await import("../../app/api/import/detect/route");
  return POST(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue({
    id: "user-1",
    email: "staff@example.co.jp",
    name: "入力担当",
    role: "input_staff",
  });
  findDuplicateMock.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/import/detect", () => {
  it("ログインしていなければ401(下読みも権限の内側)", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const res = await detect(csvFile("a.csv", salesMonitorCsv(["2026/05/01"])));
    expect(res.status).toBe(401);
  });

  it("別サイトからの送信は403", async () => {
    const res = await detect(csvFile("a.csv", salesMonitorCsv(["2026/05/01"])), {}, "https://evil.example");
    expect(res.status).toBe(403);
  });

  it("ファイルが無ければ400", async () => {
    const form = new FormData();
    const request = new Request("http://test/api/import/detect", {
      method: "POST",
      headers: { origin: ORIGIN },
    });
    request.formData = async () => form;
    const { POST } = await import("../../app/api/import/detect/route");
    expect((await POST(request)).status).toBe(400);
  });

  it("20MBを超えるファイルは413(取込本体と同じ上限)", async () => {
    const file = csvFile("a.csv", "x");
    Object.defineProperty(file, "size", { value: 21 * 1024 * 1024 });
    expect((await detect(file)).status).toBe(413);
  });

  it("ファイル名ではなく列見出しで帳票を見分け、日付列から対象年月を出す", async () => {
    const csv = salesMonitorCsv(["2026/05/01", "2026/05/02", "2026/05/03"]);
    // 名前は運行実績表を名乗っているが、中身は売上モニタリスト。
    const res = await detect(csvFile("車両別運行実績表.csv", csv), {
      screen: "import",
      expectedSourceType: "sales_monitor",
      expectedYearMonth: "2026-05",
    });
    const body = (await res.json()) as DetectBody;
    expect(body.sourceType).toBe("sales_monitor");
    expect(body.yearMonth).toBe("2026-05");
    expect(body.rowCount).toBe(3);
    expect(body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.verdict.status).toBe("ok");
  });

  it("取込口と違う帳票なら止めて、正しい取込口を示す", async () => {
    const csv = salesMonitorCsv(["2026/05/01"]);
    const res = await detect(csvFile("なんとか.csv", csv), {
      screen: "import",
      expectedSourceType: "payroll",
      expectedYearMonth: "2026-05",
    });
    const body = (await res.json()) as DetectBody;
    expect(body.verdict.status).toBe("blocked");
    expect(kindsOf(body.verdict)).toContain("typeMismatch");
  });

  it("選んだ月と中身の月が違えば、どちらで取り込むかを選ばせる", async () => {
    const csv = salesMonitorCsv(["2026/04/01", "2026/04/02"]);
    const res = await detect(csvFile("売上.csv", csv), {
      screen: "import",
      expectedSourceType: "sales_monitor",
      expectedYearMonth: "2026-05",
    });
    const body = (await res.json()) as DetectBody;
    expect(kindsOf(body.verdict)).toContain("yearMonthMismatch");
    expect(body.verdict.needsYearMonthChoice).toBe(true);
  });

  it("同じ画面に取り込み済みの中身なら、取込前に知らせる", async () => {
    findDuplicateMock.mockResolvedValue({
      match: "sameContentSameName",
      fileName: "売上.csv",
      importedAt: Date.parse("2026-08-05T01:00:00Z"),
      rowCount: 3,
      yearMonth: "2026-05",
    });
    const csv = salesMonitorCsv(["2026/05/01"]);
    const res = await detect(csvFile("売上.csv", csv), {
      screen: "import",
      expectedSourceType: "sales_monitor",
      expectedYearMonth: "2026-05",
    });
    const body = (await res.json()) as DetectBody;
    expect(kindsOf(body.verdict)).toContain("duplicate");
    // 照合は画面ごと(同じExcelを車両マスタと運転者マスタの両方で使うため)。
    expect(findDuplicateMock).toHaveBeenCalledWith(
      expect.objectContaining({ screen: "import", fileName: "売上.csv" }),
    );
  });

  it("画面の指定が無ければ月次データ取込として扱う", async () => {
    await detect(csvFile("売上.csv", salesMonitorCsv(["2026/05/01"])));
    expect(findDuplicateMock).toHaveBeenCalledWith(expect.objectContaining({ screen: "import" }));
  });

  it("マスタ画面は必須列を画面基準で見る(足りない列名を具体的に返す)", async () => {
    const res = await detect(csvFile("車両マスタ.csv", "車番,車種名\n24,大型\n"), {
      screen: "vehicle_master",
    });
    const body = (await res.json()) as DetectBody;
    expect(kindsOf(body.verdict)).toContain("missingColumns");
    expect(body.verdict.status).toBe("blocked");
    // 「形式が不正です」ではなく、足りない列名を挙げる。
    expect(body.verdict.issues[0]?.body).toContain("「所属」");
  });

  it("中身を読み取れなくても取込は止めず、年月を選んでもらう", async () => {
    findDuplicateMock.mockRejectedValue(new Error("db down"));
    const res = await detect(csvFile("売上.csv", salesMonitorCsv(["2026/05/01"])), {
      screen: "import",
      expectedSourceType: "sales_monitor",
      expectedYearMonth: "2026-05",
    });
    const body = (await res.json()) as DetectBody;
    expect(res.status).toBe(200);
    expect(body.sourceType).toBe("unknown");
    expect(body.verdict.needsYearMonthChoice).toBe(true);
    expect(body.verdict.status).toBe("confirm");
  });
});
