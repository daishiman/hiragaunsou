import { describe, expect, it } from "vitest";
import {
  cleansingClusterKey,
  detectCleansingFlags,
  needsHumanDecision,
  suggestDecision,
} from "../../src/domain/rules/cleansingRules";

describe("detectCleansingFlags (業務フロー STEP1 データ整形)", () => {
  it("車番88888は傭車として自動処理扱いにする(人の判断を求めない)", () => {
    const flags = detectCleansingFlags({ vehicleNo: "88888", driverName: "山田" });
    expect(flags).toHaveLength(1);
    expect(flags[0]?.type).toBe("chartered");
    expect(flags[0]?.severity).toBe("auto");
    expect(needsHumanDecision(flags)).toBe(false);
  });

  it("傭車は他の条件に当てはまっても傭車としてだけ扱う", () => {
    const flags = detectCleansingFlags({ vehicleNo: "88888", driverName: "諸口" });
    expect(flags.map((f) => f.type)).toEqual(["chartered"]);
  });

  it("過去に2重計上の実績がある車番(888・10・5000)は要確認にする", () => {
    for (const no of ["888", "10", "5000"]) {
      const flags = detectCleansingFlags({ vehicleNo: no, driverName: "山田" });
      expect(flags.map((f) => f.type)).toEqual(["duplicate_suspect"]);
      expect(needsHumanDecision(flags)).toBe(true);
    }
  });

  it("運転者が「諸口」なら要確認にする", () => {
    const flags = detectCleansingFlags({ vehicleNo: "24", driverName: "諸口" });
    expect(flags.map((f) => f.type)).toEqual(["misc_entry"]);
    expect(needsHumanDecision(flags)).toBe(true);
  });

  it("2重計上の実績がある車番かつ諸口なら両方のフラグが立つ", () => {
    const flags = detectCleansingFlags({ vehicleNo: "888", driverName: "諸口" });
    expect(flags.map((f) => f.type)).toEqual(["duplicate_suspect", "misc_entry"]);
  });

  it("通常の伝票にはフラグを立てない(全件を人に見せない)", () => {
    expect(detectCleansingFlags({ vehicleNo: "24", driverName: "山田" })).toEqual([]);
  });

  it("前後の空白は判定に影響しない", () => {
    expect(detectCleansingFlags({ vehicleNo: " 88888 ", driverName: "" })[0]?.type).toBe(
      "chartered",
    );
    expect(detectCleansingFlags({ vehicleNo: "24", driverName: " 諸口 " })[0]?.type).toBe(
      "misc_entry",
    );
  });

  it("フラグの理由は必ず文章で持つ(なぜ出たか画面で説明できるようにする)", () => {
    const flags = detectCleansingFlags({ vehicleNo: "5000", driverName: "諸口" });
    expect(flags.every((f) => f.reason.length > 0)).toBe(true);
  });
});

describe("suggestDecision (前月の判断を提案する)", () => {
  it("前月の判断が無ければ提案しない", () => {
    expect(suggestDecision(undefined)).toBeNull();
  });

  it("前月の判断をそのまま提案し、理由に年月を含める", () => {
    const s = suggestDecision({ decision: "delete", yearMonth: "2026-04", note: null });
    expect(s?.decision).toBe("delete");
    expect(s?.reason).toContain("2026-04");
    expect(s?.reason).toContain("除外する");
  });

  it("メモがあれば提案理由に含める", () => {
    const s = suggestDecision({
      decision: "correct",
      yearMonth: "2026-04",
      note: "請求書発行担当に確認済み",
    });
    expect(s?.reason).toContain("請求書発行担当に確認済み");
  });
});

describe("cleansingClusterKey (同じ内容の伝票を束ねる基準)", () => {
  it("車番が空なら束ねない(空文字キーを返す)", () => {
    const key = cleansingClusterKey({
      vehicleNo: "",
      driverName: "山田",
      customerName: "東洋インキ",
      loadDate: "2026-05-01",
      amount: 700,
      flags: [],
    });
    expect(key).toBe("");
  });

  it("荷主名が空なら束ねない(空文字キーを返す)", () => {
    const key = cleansingClusterKey({
      vehicleNo: "4242",
      driverName: "山田",
      customerName: "",
      loadDate: "2026-05-01",
      amount: 700,
      flags: [],
    });
    expect(key).toBe("");
  });

  it("車番・荷主・金額・フラグ種類が一致すれば同じキーになる(積荷日は基準に含めない)", () => {
    const base = {
      vehicleNo: "4242",
      driverName: "諸口",
      customerName: "東洋インキ㈱",
      amount: 700,
      flags: [{ type: "misc_entry" as const, severity: "review" as const, reason: "x" }],
    };
    const key1 = cleansingClusterKey({ ...base, loadDate: "2026-05-01" });
    const key2 = cleansingClusterKey({ ...base, loadDate: "2026-05-15" });
    expect(key1).toBe(key2);
  });

  it("金額が異なれば別キーになる(たまたま同じ車番×荷主というだけの別内容を混ぜない)", () => {
    const base = {
      vehicleNo: "4242",
      driverName: "諸口",
      customerName: "東洋インキ",
      loadDate: "2026-05-01",
      flags: [],
    };
    const key1 = cleansingClusterKey({ ...base, amount: 700 });
    const key2 = cleansingClusterKey({ ...base, amount: 800 });
    expect(key1).not.toBe(key2);
  });
});
