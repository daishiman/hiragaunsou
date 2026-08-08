import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * マスタ取込の記録(app/_lib/recordFileImport.ts)。
 *
 * ここが誤ると「取り込み済みです」の判定が狂う。特に、中身の指紋が無いのに名前だけで
 * 記録してしまうと、次に別の中身の同名ファイルを選んだとき誤って同一扱いになるため、
 * 「指紋が無ければ記録しない」を固定する。
 */
const { recordMock } = vi.hoisted(() => ({ recordMock: vi.fn() }));
vi.mock("../../src/infrastructure/db/D1FileImportLogRepository", () => ({
  D1FileImportLogRepository: class {
    record = recordMock;
  },
}));

const SESSION = { id: "user-1", name: "事務担当" };

async function record(input: {
  fileName?: unknown;
  contentHash?: unknown;
  rowCount?: number;
}): Promise<void> {
  const { recordFileImport } = await import("../../app/_lib/recordFileImport");
  await recordFileImport({} as never, {
    screen: "vehicle_master",
    fileName: input.fileName,
    contentHash: input.contentHash,
    rowCount: input.rowCount ?? 12,
    session: SESSION,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  recordMock.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordFileImport", () => {
  it("中身の指紋があれば、画面・件数・取込者つきで記録する", async () => {
    await record({ fileName: "★車両別収支計算用.xlsx", contentHash: "abc", rowCount: 34 });
    expect(recordMock).toHaveBeenCalledWith({
      screen: "vehicle_master",
      sourceType: "vehicle_master",
      yearMonth: null,
      fileName: "★車両別収支計算用.xlsx",
      contentHash: "abc",
      rowCount: 34,
      importedBy: "user-1",
      importedByName: "事務担当",
    });
  });

  it("中身の指紋が無ければ記録しない(名前だけの記録は誤判定のもと)", async () => {
    await record({ fileName: "★車両別収支計算用.xlsx", contentHash: undefined });
    await record({ fileName: "★車両別収支計算用.xlsx", contentHash: "" });
    await record({ fileName: "★車両別収支計算用.xlsx", contentHash: 123 });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("ファイル名が届かなくても記録は残す(名前は参考情報にすぎない)", async () => {
    await record({ fileName: undefined, contentHash: "abc" });
    expect(recordMock.mock.calls[0]?.[0]).toMatchObject({ fileName: "(名前不明)" });
  });

  it("記録に失敗しても呼び出し側を失敗させない(マスタ自体は取り込めている)", async () => {
    recordMock.mockRejectedValue(new Error("db down"));
    await expect(record({ fileName: "a.csv", contentHash: "abc" })).resolves.toBeUndefined();
  });
});
