import { describe, expect, it } from "vitest";
import { IMPORT_SOURCES, findImportSource } from "../../src/domain/rules/importSources";

describe("findImportSource", () => {
  it("sourceTypeが一致する帳票定義を返す", () => {
    const source = findImportSource("vehicle_operation");
    expect(source?.label).toBe("車両別運行実績表");
    expect(source?.step).toBe("STEP1");
  });

  it("車両別運行実績表は3営業所分が別ファイルで届くためmultiFileがtrue", () => {
    const source = findImportSource("vehicle_operation");
    expect(source?.multiFile).toBe(true);
  });

  it("売上モニタリストは月1ファイルのためmultiFileがfalse(取込全体を入れ直す対象)", () => {
    const source = findImportSource("sales_monitor");
    expect(source?.multiFile).toBe(false);
  });

  it("存在しないsourceTypeはundefinedを返す(呼び出し側で404等の分岐に使える)", () => {
    expect(findImportSource("unknown_type")).toBeUndefined();
  });

  it("空文字のsourceTypeもundefinedを返す", () => {
    expect(findImportSource("")).toBeUndefined();
  });

  it("IMPORT_SOURCESの全件がfindImportSourceで引ける(定義漏れが無い)", () => {
    for (const source of IMPORT_SOURCES) {
      expect(findImportSource(source.sourceType)?.label).toBe(source.label);
    }
  });
});
