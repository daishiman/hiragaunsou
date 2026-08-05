import { describe, expect, it, vi, beforeEach } from "vitest";
import Encoding from "encoding-japanese";

/**
 * POST /api/import/[sourceType] の対象年月チェック(取込確定前に、選んだ年月とファイルの中身の
 * 積荷日が食い違っていないか気づけるようにする機能)を検証する。
 * 既存の tests/api/importRouteGuards.test.ts は変更せず、別ファイルとして追加する。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

const { getServerSessionMock } = vi.hoisted(() => ({ getServerSessionMock: vi.fn() }));
vi.mock("../../src/infrastructure/auth/session", () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({
    env: { DB: {}, IMPORTS_BUCKET: {}, BETTER_AUTH_URL: ORIGIN },
  })),
}));

vi.mock("../../src/infrastructure/db/client", () => ({ createDb: vi.fn(() => ({})) }));

const { findBatchesMock, deleteBatchesMock } = vi.hoisted(() => ({
  findBatchesMock: vi.fn(),
  deleteBatchesMock: vi.fn(),
}));
vi.mock("../../src/infrastructure/db/D1ImportBatchRepository", () => ({
  D1ImportBatchRepository: class {
    findBatches = findBatchesMock;
    deleteBatches = deleteBatchesMock;
  },
}));

vi.mock("../../src/infrastructure/storage/R2FileStorageRepository", () => ({
  R2FileStorageRepository: class {
    save = vi.fn();
  },
}));

vi.mock("../../src/infrastructure/db/D1VehiclePlRepository", () => ({
  D1VehiclePlRepository: class {},
}));

const { salesMonitorMock } = vi.hoisted(() => ({ salesMonitorMock: vi.fn() }));
vi.mock("../../src/usecase/steps/importVehicleOperation", () => ({
  ImportVehicleOperationUseCase: class {
    execute = vi.fn();
  },
}));
vi.mock("../../src/usecase/steps/importSalesMonitor", () => ({
  ImportSalesMonitorUseCase: class {
    execute = salesMonitorMock;
  },
}));
vi.mock("../../src/usecase/steps/importPayroll", () => ({
  ImportPayrollUseCase: class {
    execute = vi.fn();
  },
}));
vi.mock("../../src/usecase/steps/importMonthlyPlWorkbook", () => ({
  MONTHLY_PL_WORKBOOK_SOURCE_TYPE: "monthly_pl_workbook",
  ImportMonthlyPlWorkbookUseCase: class {
    execute = vi.fn();
  },
}));

function cp932(text: string): Uint8Array {
  return new Uint8Array(Encoding.convert(Encoding.stringToCode(text), { to: "SJIS", from: "UNICODE" }));
}

function csvFile(fileName: string, text: string): File {
  return new File([cp932(text)], fileName, { type: "text/csv" });
}

function buildRequest(form: FormData, origin: string | null = ORIGIN): Request {
  const request = new Request("http://test/api/import/sales_monitor", {
    method: "POST",
    headers: origin ? { origin } : {},
  });
  request.formData = async () => form;
  return request;
}

function formOf(file: File, yearMonth: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append("file", file);
  form.append("yearMonth", yearMonth);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}

async function post(sourceType: string, form: FormData) {
  const { POST } = await import("../../app/api/import/[sourceType]/route");
  return POST(buildRequest(form), { params: Promise.resolve({ sourceType }) });
}

const SALES_MONITOR_HEADER =
  "車両コード,運転者名,受取運賃,通行料,燃料サーチャージ,待機時間料,付帯料金,管理№,行№,荷主先略称,積荷日";

function salesMonitorCsv(rows: { vehicleCode: string; loadDate: string }[]): string {
  const lines = rows.map(
    (r, i) => `${r.vehicleCode},運転者${i},1000,200,0,0,0,S00${i},1,テスト荷主,${r.loadDate}`,
  );
  return [SALES_MONITOR_HEADER, ...lines].join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue({
    id: "user-1",
    email: "staff@example.co.jp",
    name: "入力担当",
    role: "input_staff",
  });
  findBatchesMock.mockResolvedValue([]);
  deleteBatchesMock.mockResolvedValue(0);
  salesMonitorMock.mockResolvedValue({ batchId: "b2", storedFileKey: "k2", totalRows: 5, charteredExcluded: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/import/sales_monitor の対象年月チェック", () => {
  it("積荷日が選択した年月と食い違えば409(取込を確定しない)", async () => {
    const csv = salesMonitorCsv([
      { vehicleCode: "101", loadDate: "2026/06/01" },
      { vehicleCode: "102", loadDate: "2026/06/02" },
      { vehicleCode: "103", loadDate: "2026/06/03" },
    ]);
    const res = await post("sales_monitor", formOf(csvFile("売上モニタリスト.csv", csv), "2026-07"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      yearMonthMismatch: { selectedYearMonth: string; detectedYearMonth: string; matchedRows: number };
    };
    expect(body.error).toBe("yearMonthMismatch");
    expect(body.yearMonthMismatch.selectedYearMonth).toBe("2026-07");
    expect(body.yearMonthMismatch.detectedYearMonth).toBe("2026-06");
    expect(body.yearMonthMismatch.matchedRows).toBe(3);
    expect(salesMonitorMock).not.toHaveBeenCalled();
  });

  it("積荷日が選択した年月と一致すればそのまま取り込む", async () => {
    const csv = salesMonitorCsv([
      { vehicleCode: "101", loadDate: "2026/07/01" },
      { vehicleCode: "102", loadDate: "2026/07/02" },
    ]);
    const res = await post("sales_monitor", formOf(csvFile("売上モニタリスト.csv", csv), "2026-07"));
    expect(res.status).toBe(200);
    expect(salesMonitorMock).toHaveBeenCalledTimes(1);
  });

  it("confirmYearMonth=trueを付ければ食い違っていてもそのまま取り込む(利用者が確認済み)", async () => {
    const csv = salesMonitorCsv([
      { vehicleCode: "101", loadDate: "2026/06/01" },
      { vehicleCode: "102", loadDate: "2026/06/02" },
    ]);
    const res = await post(
      "sales_monitor",
      formOf(csvFile("売上モニタリスト.csv", csv), "2026-07", { confirmYearMonth: "true" }),
    );
    expect(res.status).toBe(200);
    expect(salesMonitorMock).toHaveBeenCalledTimes(1);
  });

  it("積荷日を読み取れないファイルは判定できないため、そのまま取り込む", async () => {
    // 必須列(積荷日等)が無いCSV。detectFileTypeの緩い判定では sales_monitor と判定されうるが、
    // parseSalesMonitorCsvの厳密な必須列チェックには失敗するため、年月チェックは諦めて素通りする。
    const csv = "車両コード,受取運賃,通行料\n101,1000,200\n";
    const res = await post("sales_monitor", formOf(csvFile("売上モニタリスト.csv", csv), "2026-07"));
    expect(res.status).toBe(200);
    expect(salesMonitorMock).toHaveBeenCalledTimes(1);
  });
});
