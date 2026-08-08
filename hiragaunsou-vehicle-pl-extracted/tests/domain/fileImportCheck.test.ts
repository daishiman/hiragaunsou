import { describe, expect, it } from "vitest";
import {
  acceptedSourceTypesFor,
  describeImportedAt,
  describeScreenExpectation,
  describeSourceType,
  evaluateFileImport,
  expectedLabelFor,
  type FileImportCheckInput,
} from "../../src/domain/rules/fileImportCheck";

/**
 * 取込前チェックの言葉と「止める/通す」の判断は、全画面で同じであることが仕様の中心
 * (docs/product/file-import-common-spec.md)。ここが崩れると、画面ごとに違う案内が出て
 * 利用者が別の意味だと誤解するため、判定と文言の両方を固定する。
 */
function baseInput(overrides: Partial<FileImportCheckInput> = {}): FileImportCheckInput {
  return {
    screen: "import",
    acceptedSourceTypes: ["payroll"],
    expectedLabel: "給与集計表(日給者)",
    detectedSourceType: "payroll",
    expectedYearMonth: "2026-05",
    detectedYearMonth: "2026-05",
    yearMonthBasis: "日付の列から判定しました。",
    yearMonthCandidates: ["2026-05"],
    missingColumns: [],
    rowCount: 120,
    duplicate: null,
    ...overrides,
  };
}

describe("evaluateFileImport", () => {
  it("問題がなければそのまま取り込める", () => {
    const verdict = evaluateFileImport(baseInput());
    expect(verdict.status).toBe("ok");
    expect(verdict.issues).toHaveLength(0);
    expect(verdict.confirmLabel).toBeNull();
    expect(verdict.summary).toBe("「給与集計表(日給者)」 / 2026年5月分・120件");
  });

  it("帳票の種類が違えば取込を止め、正しい画面への導線を出す", () => {
    const verdict = evaluateFileImport(baseInput({ detectedSourceType: "sales_monitor" }));
    expect(verdict.status).toBe("blocked");
    expect(verdict.confirmLabel).toBeNull();
    expect(verdict.issues[0]!.title).toBe("このファイルは「売上モニタリスト」のようです");
    expect(verdict.issues[0]!.body).toContain("この欄は「給与集計表(日給者)」を取り込むところです");
    expect(verdict.issues[0]!.link?.href).toBe("/import");
  });

  it("何の帳票か判定できなければ止める(名前では判定しない旨も伝える)", () => {
    const verdict = evaluateFileImport(baseInput({ detectedSourceType: "unknown" }));
    expect(verdict.status).toBe("blocked");
    expect(verdict.issues[0]!.kind).toBe("typeUnknown");
    expect(verdict.issues[0]!.body).toContain("ファイル名は変わっていても構いません");
  });

  it("列が足りなければ足りない列名を具体的に挙げて止める", () => {
    const verdict = evaluateFileImport(baseInput({ missingColumns: ["車番", "社員No"] }));
    expect(verdict.status).toBe("blocked");
    expect(verdict.issues[0]!.body).toContain("「車番」「社員No」の列が見つかりませんでした");
  });

  it("種類違いは列不足より優先して伝える(症状ではなく原因を出す)", () => {
    const verdict = evaluateFileImport(
      baseInput({ detectedSourceType: "sales_monitor", missingColumns: ["車番"] }),
    );
    expect(verdict.issues).toHaveLength(1);
    expect(verdict.issues[0]!.kind).toBe("typeMismatch");
  });

  it("月が違えば勝手にどちらかへ倒さず、選ばせる", () => {
    const verdict = evaluateFileImport(baseInput({ detectedYearMonth: "2026-04" }));
    expect(verdict.status).toBe("confirm");
    expect(verdict.needsYearMonthChoice).toBe(true);
    expect(verdict.suggestedYearMonth).toBe("2026-04");
    expect(verdict.issues[0]!.body).toContain(
      "選ばれたファイルは2026年4月分ですが、いま作成中なのは2026年5月分です",
    );
    expect(verdict.confirmLabel).toBe("2026年4月分として取り込む");
  });

  it("複数の月が混ざっていれば候補を示して選ばせる", () => {
    const verdict = evaluateFileImport(
      baseInput({ yearMonthCandidates: ["2026-05", "2026-04"] }),
    );
    expect(verdict.status).toBe("confirm");
    expect(verdict.issues[0]!.kind).toBe("yearMonthMixed");
    expect(verdict.issues[0]!.body).toContain("2026年5月 / 2026年4月");
  });

  it("年月が判定できなければ選ばせる", () => {
    const verdict = evaluateFileImport(
      baseInput({ detectedYearMonth: null, yearMonthCandidates: [] }),
    );
    expect(verdict.issues[0]!.kind).toBe("yearMonthUnknown");
    expect(verdict.suggestedYearMonth).toBe("2026-05");
    expect(verdict.confirmLabel).toBe("2026年5月分として取り込む");
  });

  it("月に紐づかない取込(マスタ)では年月を尋ねない", () => {
    const verdict = evaluateFileImport(
      baseInput({
        screen: "vehicle_master",
        acceptedSourceTypes: ["monthly_pl_workbook", "unknown"],
        detectedSourceType: "unknown",
        expectedYearMonth: null,
        detectedYearMonth: null,
      }),
    );
    expect(verdict.status).toBe("ok");
    expect(verdict.needsYearMonthChoice).toBe(false);
  });

  it("中身も名前も同じなら「取り込み済み」と伝えて確認を取る", () => {
    const verdict = evaluateFileImport(
      baseInput({
        duplicate: {
          match: "sameContentSameName",
          fileName: "給与集計表.csv",
          importedAt: new Date("2026-08-05T10:00:00+09:00").getTime(),
          rowCount: 120,
          yearMonth: "2026-05",
        },
      }),
    );
    expect(verdict.status).toBe("confirm");
    expect(verdict.issues[0]!.title).toContain("に取り込み済みです(中身も同じです)");
    expect(verdict.confirmLabel).toBe("それでも取り込む");
  });

  it("名前が同じで中身が違えば、何が変わったかを要約して置き換えを確認する", () => {
    const verdict = evaluateFileImport(
      baseInput({
        rowCount: 130,
        duplicate: {
          match: "sameNameChangedContent",
          fileName: "給与集計表.csv",
          importedAt: Date.now(),
          rowCount: 120,
          yearMonth: "2026-05",
        },
      }),
    );
    expect(verdict.issues[0]!.body).toContain("前回は120件、今回は130件で10件増えています");
    expect(verdict.confirmLabel).toBe("新しい内容で置き換える");
  });

  it("件数も年月も同じなら「どこかが書き換わっている」と正直に伝える", () => {
    const verdict = evaluateFileImport(
      baseInput({
        duplicate: {
          match: "sameNameChangedContent",
          fileName: "給与集計表.csv",
          importedAt: Date.now(),
          rowCount: 120,
          yearMonth: "2026-05",
        },
      }),
    );
    expect(verdict.issues[0]!.body).toContain("中身のどこかが書き換わっています");
  });

  it("名前が違っても中身が同じなら、当時のファイル名を添えて知らせる", () => {
    const verdict = evaluateFileImport(
      baseInput({
        duplicate: {
          match: "sameContentOtherName",
          fileName: "きゅうよ(コピー).csv",
          importedAt: Date.now(),
          rowCount: 120,
          yearMonth: "2026-05",
        },
      }),
    );
    expect(verdict.issues[0]!.body).toContain("「きゅうよ(コピー).csv」");
  });

  it("重複と月違いが重なったら両方見せ、ボタンは年月の確定を優先する", () => {
    const verdict = evaluateFileImport(
      baseInput({
        detectedYearMonth: "2026-04",
        duplicate: {
          match: "sameContentSameName",
          fileName: "給与集計表.csv",
          importedAt: Date.now(),
          rowCount: 120,
          yearMonth: "2026-04",
        },
      }),
    );
    expect(verdict.issues.map((i) => i.kind)).toEqual(["duplicate", "yearMonthMismatch"]);
    expect(verdict.confirmLabel).toBe("2026年4月分として取り込む");
  });

  it("受け付ける種類を指定しない投入口では種類で弾かない", () => {
    const verdict = evaluateFileImport(
      baseInput({ acceptedSourceTypes: [], detectedSourceType: "vehicle_operation" }),
    );
    expect(verdict.status).toBe("ok");
  });
});

describe("投入口ごとの受け入れ設定", () => {
  it("月次取込は指定された帳票だけを受け付ける", () => {
    expect(acceptedSourceTypesFor("import", "payroll")).toEqual(["payroll"]);
    expect(acceptedSourceTypesFor("import", null)).toEqual([]);
  });

  it("マスタ画面は社内Excelと社内様式CSV(判定不能)の両方を受け付ける", () => {
    expect(acceptedSourceTypesFor("vehicle_master", null)).toEqual([
      "monthly_pl_workbook",
      "unknown",
    ]);
    expect(acceptedSourceTypesFor("driver_master", null)).toContain("unknown");
  });

  it("投入口の呼び名は画面に合わせて出し分ける", () => {
    expect(expectedLabelFor("import", "payroll")).toBe("給与集計表(日給者)");
    expect(expectedLabelFor("import", null)).toBe("月次の帳票");
    expect(expectedLabelFor("vehicle_master", null)).toContain("車両の一覧");
  });
});

describe("表示用の細かな整形", () => {
  it("同じ年なら月日だけ、違う年なら年から出す", () => {
    const now = new Date("2026-08-08T00:00:00+09:00").getTime();
    expect(describeImportedAt(new Date("2026-08-05T09:00:00+09:00").getTime(), now)).toBe("8月5日");
    expect(describeImportedAt(new Date("2025-08-05T09:00:00+09:00").getTime(), now)).toBe(
      "2025年8月5日",
    );
  });

  it("知らない帳票種別でも生の英字を画面に出さない", () => {
    expect(describeSourceType("unknown")).toBe("この帳票");
  });

  it("画面の案内文は「名前ではなく中身で判定する」ことを必ず含む", () => {
    for (const screen of ["import", "vehicle_master", "driver_master"] as const) {
      expect(describeScreenExpectation(screen)).toContain("中身で判定します");
    }
  });
});
