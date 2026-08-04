import { describe, expect, it } from "vitest";
import {
  fiscalYearMonths,
  fiscalYearOf,
  monthLabel,
  previousFiscalYearMonths,
  sameMonthPreviousYear,
  trailingYearMonths,
} from "../../src/domain/rules/fiscalPeriod";

describe("fiscalYearOf", () => {
  it("6月以降はその年が期首年", () => {
    expect(fiscalYearOf("2025-06")).toBe(2025);
    expect(fiscalYearOf("2025-12")).toBe(2025);
  });

  it("5月以前は前年が期首年 (6月始まり決算)", () => {
    expect(fiscalYearOf("2026-05")).toBe(2025);
    expect(fiscalYearOf("2026-01")).toBe(2025);
  });
});

describe("fiscalYearMonths", () => {
  it("6月→翌5月の12ヶ月を昇順で返す", () => {
    const months = fiscalYearMonths("2026-05");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-06");
    expect(months[11]).toBe("2026-05");
  });

  it("期内のどの月から呼んでも同じ12ヶ月になる", () => {
    expect(fiscalYearMonths("2025-06")).toEqual(fiscalYearMonths("2026-05"));
  });
});

describe("previousFiscalYearMonths", () => {
  it("1期前の12ヶ月を返す (対前年比較の相手)", () => {
    const months = previousFiscalYearMonths("2026-05");
    expect(months[0]).toBe("2024-06");
    expect(months[11]).toBe("2025-05");
  });
});

describe("trailingYearMonths", () => {
  it("対象月を末尾に含む直近nヶ月を昇順で返す", () => {
    const months = trailingYearMonths("2026-05", 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-06");
    expect(months[11]).toBe("2026-05");
  });

  it("年をまたいでも桁揃えの年月文字列になる", () => {
    expect(trailingYearMonths("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("sameMonthPreviousYear / monthLabel", () => {
  it("前年同月を返す", () => {
    expect(sameMonthPreviousYear("2026-05")).toBe("2025-05");
  });

  it("表示ラベルは月だけにする", () => {
    expect(monthLabel("2025-06")).toBe("6月");
  });
});
