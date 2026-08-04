import { describe, expect, it } from "vitest";
import { buildImportFileKey } from "../../src/domain/repositories/FileStorageRepository";

describe("buildImportFileKey", () => {
  it("R2キーに元ファイル名のパス区切りや制御文字を持ち込まない", () => {
    const key = buildImportFileKey("2026-05", "monthly_pl_workbook", 1, "../帳票/五月\u0000.xlsx");
    expect(key).toBe("imports/2026-05/monthly_pl_workbook/1_.._帳票_五月_.xlsx");
    expect(key.split("/")).toHaveLength(4);
  });
});
