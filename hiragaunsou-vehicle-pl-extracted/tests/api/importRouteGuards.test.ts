import { describe, expect, it, vi, beforeEach } from "vitest";
import Encoding from "encoding-japanese";

/**
 * POST /api/import/[sourceType] の分岐を検証する。
 * このルートは「権限 → CSRF → 入力検証 → サイズ上限 → 種別判定/取り違え検知 → 入れ直し判定 → UseCase振り分け」
 * という段階的な防御を持ち、どの段で止まったかで返すステータスが変わる。
 * UseCase本体・R2・D1はモックし、種別判定(detectFileType/parseCsv/decodeCp932)は実物を使う。
 *
 * 未ログイン→401は tests/api/routeAuthGuards.test.ts で検証済みのためここでは扱わない。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

const { vehicleOperationMock, salesMonitorMock, payrollMock, workbookMock } = vi.hoisted(() => ({
  vehicleOperationMock: vi.fn(),
  salesMonitorMock: vi.fn(),
  payrollMock: vi.fn(),
  workbookMock: vi.fn(),
}));
vi.mock("../../src/usecase/steps/importVehicleOperation", () => ({
  ImportVehicleOperationUseCase: class {
    execute = vehicleOperationMock;
  },
}));
vi.mock("../../src/usecase/steps/importSalesMonitor", () => ({
  ImportSalesMonitorUseCase: class {
    execute = salesMonitorMock;
  },
}));
vi.mock("../../src/usecase/steps/importPayroll", () => ({
  ImportPayrollUseCase: class {
    execute = payrollMock;
  },
}));
vi.mock("../../src/usecase/steps/importMonthlyPlWorkbook", () => ({
  MONTHLY_PL_WORKBOOK_SOURCE_TYPE: "monthly_pl_workbook",
  ImportMonthlyPlWorkbookUseCase: class {
    execute = workbookMock;
  },
}));

// 種別判定は実物のロジックを通す。例外経路(422)を作るときだけ差し替えられるよう包んでおく。
const { detectFileTypeMock } = vi.hoisted(() => ({ detectFileTypeMock: vi.fn() }));
let actualDetectFileType: (fileName: string, header: string[]) => string;
const { actualParseCsv, actualDecodeCp932 } = await vi.hoisted(async () => {
  const csvUtils = await import("../../src/infrastructure/parsers/csvUtils");
  const encoding = await import("../../src/infrastructure/parsers/encoding");
  return { actualParseCsv: csvUtils.parseCsv, actualDecodeCp932: encoding.decodeCp932 };
});
vi.mock("../../src/infrastructure/parsers/detectFileType", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/infrastructure/parsers/detectFileType")>();
  actualDetectFileType = actual.detectFileType;
  return {
    ...actual,
    detectFileType: detectFileTypeMock,
    // ルートが呼ぶのは resolveSourceTypeFromContent。中身(列見出し・ZIP判定)は実物を通しつつ、
    // 列見出しからの判定だけを detectFileTypeMock 経由にして例外経路を作れるようにする。
    resolveSourceTypeFromContent: (fileName: string, content: ArrayBuffer) => {
      const bytes = new Uint8Array(content);
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "monthly_pl_workbook";
      const rows = actualParseCsv(actualDecodeCp932(content.slice(0, 64 * 1024)));
      return detectFileTypeMock(fileName, rows[0] ?? []);
    },
  };
});

function cp932(text: string): Uint8Array {
  return new Uint8Array(Encoding.convert(Encoding.stringToCode(text), { to: "SJIS", from: "UNICODE" }));
}

/** 実データと同じcp932エンコードのCSVファイルを作る */
function csvFile(fileName: string, text: string): File {
  return new File([cp932(text)], fileName, { type: "text/csv" });
}

/** xlsx(ZIP)の先頭マジックバイト "PK" を持つファイル。resolveSourceTypeのExcel判定経路用。 */
function xlsxFile(fileName: string): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])], fileName);
}

/**
 * FormDataをRequestのボディに載せると `request.formData()` が再パースしてFileを作り直すため、
 * サイズ上限のような「Fileのメタデータ」に着目したテストができない。
 * Originヘッダーは実物のRequestに持たせたまま、formData()だけを差し替える。
 */
function buildRequest(form: FormData, origin: string | null = ORIGIN): Request {
  const request = new Request("http://test/api/import/auto", {
    method: "POST",
    headers: origin ? { origin } : {},
  });
  request.formData = async () => form;
  return request;
}

function formOf(file: File | string | null, yearMonth: string | null, replace?: string): FormData {
  const form = new FormData();
  if (file !== null) form.append("file", file);
  if (yearMonth !== null) form.append("yearMonth", yearMonth);
  if (replace !== undefined) form.append("replace", replace);
  return form;
}

async function post(sourceType: string, form: FormData, origin: string | null = ORIGIN) {
  const { POST } = await import("../../app/api/import/[sourceType]/route");
  return POST(buildRequest(form, origin), { params: Promise.resolve({ sourceType }) });
}

const VEHICLE_OPERATION_CSV = "車両番号,稼動時間,総距離\n1,8.0,120\n";
const SALES_MONITOR_CSV = "車両コード,受取運賃,通行料\n1,1000,200\n";

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue({
    id: "user-1",
    email: "staff@example.co.jp",
    name: "入力担当",
    role: "input_staff",
  });
  detectFileTypeMock.mockImplementation((fileName: string, header: string[]) =>
    actualDetectFileType(fileName, header),
  );
  findBatchesMock.mockResolvedValue([]);
  deleteBatchesMock.mockResolvedValue(0);
  vehicleOperationMock.mockResolvedValue({ batchId: "b1", storedFileKey: "k1", totalRows: 3, charteredExcluded: 1 });
  salesMonitorMock.mockResolvedValue({ batchId: "b2", storedFileKey: "k2", totalRows: 5, charteredExcluded: 0 });
  payrollMock.mockResolvedValue({ batchId: "b3", storedFileKey: "k3", totalRows: 7 });
  workbookMock.mockResolvedValue({ batchId: "b4", storedFileKey: "k4", sourceSheet: "5月収支表", totalRows: 20 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/import/[sourceType] の入口ガード", () => {
  it("input権限を持たないロール(executive)は401", async () => {
    getServerSessionMock.mockResolvedValue({
      id: "user-2",
      email: "exec@example.co.jp",
      name: "社長",
      role: "executive",
    });
    const res = await post("auto", formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), "2026-05"));
    expect(res.status).toBe(401);
    expect(vehicleOperationMock).not.toHaveBeenCalled();
  });

  it("Originが一致しなければ403(CSRF対策)", async () => {
    const res = await post(
      "auto",
      formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), "2026-05"),
      "https://evil.example.com",
    );
    expect(res.status).toBe(403);
  });

  it("Originヘッダーが無ければ403(ブラウザ外からの呼び出し)", async () => {
    const res = await post("auto", formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), "2026-05"), null);
    expect(res.status).toBe(403);
  });

  it("SOURCE_TYPES外のsourceTypeは400", async () => {
    const res = await post("invoice", formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), "2026-05"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "指定された帳票の種類は取り込めません" });
  });
});

describe("POST /api/import/[sourceType] の入力検証", () => {
  it("fileが無ければ400", async () => {
    const res = await post("auto", formOf(null, "2026-05"));
    expect(res.status).toBe(400);
  });

  it("fileがFileでなく文字列なら400", async () => {
    const res = await post("auto", formOf("not-a-file", "2026-05"));
    expect(res.status).toBe(400);
  });

  it("yearMonthが無ければ400", async () => {
    const res = await post("auto", formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), null));
    expect(res.status).toBe(400);
  });

  it.each(["2026-13", "2026-00", "2026-5", "202605", "2026-05-01", ""])(
    "yearMonthがYYYY-MM形式でない(%s)なら400",
    async (yearMonth) => {
      const res = await post("auto", formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), yearMonth));
      expect(res.status).toBe(400);
    },
  );

  it.each(["2026-01", "2026-09", "2026-10", "2026-12"])("月の境界(%s)は受理される", async (yearMonth) => {
    const res = await post("vehicle_operation", formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), yearMonth));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/import/[sourceType] のファイルサイズ上限", () => {
  /** 20MBの実バイト列を確保せずに上限判定だけを検証するため、sizeだけを差し替える */
  function fileOfSize(size: number): File {
    const file = csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV);
    Object.defineProperty(file, "size", { value: size });
    return file;
  }

  it("ちょうど20MBは受理される", async () => {
    const res = await post("vehicle_operation", formOf(fileOfSize(MAX_UPLOAD_BYTES), "2026-05"));
    expect(res.status).toBe(200);
  });

  it("20MB+1バイトは413", async () => {
    const res = await post("vehicle_operation", formOf(fileOfSize(MAX_UPLOAD_BYTES + 1), "2026-05"));
    expect(res.status).toBe(413);
    expect(vehicleOperationMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/import/[sourceType] の種別判定", () => {
  it("種別判定自体が例外を投げたら422でメッセージを返す", async () => {
    detectFileTypeMock.mockImplementation(() => {
      throw new Error("見出し行の読み取りに失敗");
    });
    const res = await post("auto", formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), "2026-05"));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "見出し行の読み取りに失敗" });
  });

  it("auto指定で判定できないファイルは422", async () => {
    const res = await post("auto", formOf(csvFile("export.csv", "col_a,col_b\n1,2\n"), "2026-05"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("種別を判定できませんでした");
  });

  it("auto指定でも列見出しから種別を判定する(ファイル名に手がかりが無い場合)", async () => {
    const res = await post("auto", formOf(csvFile("export_202605.csv", SALES_MONITOR_CSV), "2026-05"));
    expect(res.status).toBe(200);
    expect((await res.json()).sourceType).toBe("sales_monitor");
    expect(salesMonitorMock).toHaveBeenCalledTimes(1);
  });

  it("改行が1つも無いCSV(見出し行だけ)でも判定できる", async () => {
    const res = await post("auto", formOf(csvFile("export.csv", "車両コード,受取運賃,通行料"), "2026-05"));
    expect(res.status).toBe(200);
    expect((await res.json()).sourceType).toBe("sales_monitor");
  });

  it("Excel(ZIPマジックバイトPK)は列見出しを読まずに収支表ブックと判定する", async () => {
    const res = await post("auto", formOf(xlsxFile("★運送収支表.xlsx"), "2026-05"));
    expect(res.status).toBe(200);
    expect((await res.json()).sourceType).toBe("monthly_pl_workbook");
    expect(detectFileTypeMock).not.toHaveBeenCalled();
  });

  it("STEP別の投入口に別帳票を入れたら422(取り違え検知)", async () => {
    const res = await post("sales_monitor", formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), "2026-05"));
    expect(res.status).toBe(422);
    const error = (await res.json()).error as string;
    expect(error).toContain("売上モニタリスト");
    expect(error).toContain("車両別運行実績表");
    expect(salesMonitorMock).not.toHaveBeenCalled();
    expect(vehicleOperationMock).not.toHaveBeenCalled();
  });

  it("STEP別の投入口では判定不能(unknown)でも投入口の種別として取り込む", async () => {
    const res = await post("payroll", formOf(csvFile("export.csv", "col_a,col_b\n1,2\n"), "2026-05"));
    expect(res.status).toBe(200);
    expect((await res.json()).sourceType).toBe("payroll");
    expect(payrollMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/import/[sourceType] の入れ直し判定", () => {
  const batch = (id: string, fileName: string) => ({ id, fileName, rowCount: 10, importedAt: 1700000000000 });

  it("複数ファイル帳票(運行実績表)は同名ファイルだけを置き換え対象とする", async () => {
    findBatchesMock.mockResolvedValue([batch("b-honsha", "運行実績表_本社.csv"), batch("b-tsuyama", "運行実績表_津山.csv")]);
    const res = await post(
      "vehicle_operation",
      formOf(csvFile("運行実績表_本社.csv", VEHICLE_OPERATION_CSV), "2026-05"),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      conflict: { sourceType: string; sameFileName: boolean; superseded: { fileName: string }[] };
    };
    expect(body.error).toBe("conflict");
    expect(body.conflict.sourceType).toBe("vehicle_operation");
    expect(body.conflict.sameFileName).toBe(true);
    expect(body.conflict.superseded).toEqual([
      { fileName: "運行実績表_本社.csv", rowCount: 10, importedAt: 1700000000000 },
    ]);
  });

  it("複数ファイル帳票で別営業所のファイルなら競合せずそのまま取り込む(既存分を消さない)", async () => {
    findBatchesMock.mockResolvedValue([batch("b-honsha", "運行実績表_本社.csv")]);
    const res = await post(
      "vehicle_operation",
      formOf(csvFile("運行実績表_津山.csv", VEHICLE_OPERATION_CSV), "2026-05"),
    );
    expect(res.status).toBe(200);
    expect(deleteBatchesMock).not.toHaveBeenCalled();
    expect(vehicleOperationMock).toHaveBeenCalledTimes(1);
  });

  it("月1ファイル帳票(売上モニタリスト)はファイル名が違ってもその月の取込全体が置き換え対象", async () => {
    findBatchesMock.mockResolvedValue([batch("b-old", "先月版.csv")]);
    const res = await post("sales_monitor", formOf(csvFile("売上モニタリスト.csv", SALES_MONITOR_CSV), "2026-05"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { conflict: { sameFileName: boolean; superseded: unknown[] } };
    expect(body.conflict.sameFileName).toBe(false);
    expect(body.conflict.superseded).toHaveLength(1);
  });

  it("既存バッチが空なら競合せず取り込む", async () => {
    findBatchesMock.mockResolvedValue([]);
    const res = await post("sales_monitor", formOf(csvFile("売上モニタリスト.csv", SALES_MONITOR_CSV), "2026-05"));
    expect(res.status).toBe(200);
    expect(deleteBatchesMock).not.toHaveBeenCalled();
  });

  it("replace=true なら既存バッチを削除してからUseCaseを実行する", async () => {
    findBatchesMock.mockResolvedValue([batch("b-old", "先月版.csv"), batch("b-older", "先々月版.csv")]);
    const res = await post(
      "sales_monitor",
      formOf(csvFile("売上モニタリスト.csv", SALES_MONITOR_CSV), "2026-05", "true"),
    );
    expect(res.status).toBe(200);
    expect(deleteBatchesMock).toHaveBeenCalledWith("2026-05", "sales_monitor", ["b-old", "b-older"]);
    expect(deleteBatchesMock.mock.invocationCallOrder[0]!).toBeLessThan(
      salesMonitorMock.mock.invocationCallOrder[0]!,
    );
  });

  it("replaceが'true'以外(チェックボックス未送信相当)なら409のまま", async () => {
    findBatchesMock.mockResolvedValue([batch("b-old", "先月版.csv")]);
    const res = await post(
      "sales_monitor",
      formOf(csvFile("売上モニタリスト.csv", SALES_MONITOR_CSV), "2026-05", "false"),
    );
    expect(res.status).toBe(409);
    expect(deleteBatchesMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/import/[sourceType] のUseCase振り分け", () => {
  it("vehicle_operation は運行実績取込UseCaseを呼び、結果にsourceTypeを添えて返す", async () => {
    const res = await post("vehicle_operation", formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), "2026-05"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sourceType: "vehicle_operation",
      batchId: "b1",
      storedFileKey: "k1",
      totalRows: 3,
      charteredExcluded: 1,
      // 取込のあとに収支表の下地を作り直した結果も返す。このテストはDBを差し替えていないので
      // 作り直しは失敗するが、取込そのものは成功として返ることをここで担保する
      // (下地づくりの失敗で取込を巻き戻さない)。
      plRebuild: { status: "skipped", reason: "failed" },
    });
    expect(vehicleOperationMock).toHaveBeenCalledWith(
      expect.objectContaining({ yearMonth: "2026-05", fileName: "運行実績表.csv", importedBy: "user-1" }),
    );
  });

  it("sales_monitor は売上モニタリスト取込UseCaseを呼ぶ", async () => {
    const res = await post("sales_monitor", formOf(csvFile("売上モニタリスト.csv", SALES_MONITOR_CSV), "2026-05"));
    expect((await res.json()).sourceType).toBe("sales_monitor");
    expect(salesMonitorMock).toHaveBeenCalledTimes(1);
    expect(vehicleOperationMock).not.toHaveBeenCalled();
  });

  it("payroll は給与集計取込UseCaseを呼ぶ", async () => {
    const res = await post("payroll", formOf(csvFile("給与集計表.csv", "社員No,総支給額\n1,300000\n"), "2026-05"));
    expect((await res.json()).sourceType).toBe("payroll");
    expect(payrollMock).toHaveBeenCalledTimes(1);
  });

  it("monthly_pl_workbook は収支表ブック取込UseCaseを呼ぶ", async () => {
    const res = await post("monthly_pl_workbook", formOf(xlsxFile("★運送収支表.xlsx"), "2026-05"));
    const body = (await res.json()) as { sourceType: string; sourceSheet: string };
    expect(body.sourceType).toBe("monthly_pl_workbook");
    expect(body.sourceSheet).toBe("5月収支表");
    expect(workbookMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/import/[sourceType] の取込失敗メッセージ", () => {
  async function failWith(error: unknown) {
    vehicleOperationMock.mockRejectedValue(error);
    const res = await post("vehicle_operation", formOf(csvFile("運行実績表.csv", VEHICLE_OPERATION_CSV), "2026-05"));
    expect(res.status).toBe(422);
    return (await res.json()).error as string;
  }

  it("Error以外が投げられたら汎用メッセージ", async () => {
    expect(await failWith("文字列で投げられた")).toBe("取込に失敗しました");
  });

  it("causeが無ければメッセージだけを返す", async () => {
    expect(await failWith(new Error("パースに失敗しました"))).toBe("パースに失敗しました");
  });

  it("Drizzleが包んだSQLダンプはparams以降を落とし、causeを先頭に出す", async () => {
    const message = await failWith(
      new Error("Failed query: insert into raw_ingestion\nparams: 1,2,3,4,5", { cause: new Error("UNIQUE constraint failed") }),
    );
    expect(message).toBe("UNIQUE constraint failed（Failed query: insert into raw_ingestion）");
    expect(message).not.toContain("params:");
  });

  it("causeが文字列でも連結する", async () => {
    expect(await failWith(new Error("保存に失敗", { cause: "D1_ERROR" }))).toBe("D1_ERROR（保存に失敗）");
  });

  it("長大なメッセージは500文字に切り詰める", async () => {
    expect(await failWith(new Error("あ".repeat(600)))).toHaveLength(500);
  });

  it("D1の1日あたり書き込み上限は原因と対処を説明するメッセージに置き換える", async () => {
    const message = await failWith(
      new Error("Failed query: insert into raw_ingestion", { cause: new Error("D1 daily limit exceeded") }),
    );
    expect(message).toContain("本日のデータベース書き込み上限");
    expect(message).not.toContain("Failed query");
  });

  it("causeが無くてもメッセージ本文に上限超過が現れれば同じ案内に置き換える", async () => {
    expect(await failWith(new Error("too many writes for this database"))).toContain(
      "本日のデータベース書き込み上限",
    );
  });
});
