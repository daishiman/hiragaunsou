import { describe, expect, it } from "vitest";
import {
  EMPTY_BENCHMARK,
  SEVERITY_MEANING,
  checkValue,
  digitFixCandidate,
  issueGuidance,
  type ValueBenchmark,
} from "../../src/domain/rules/plIssueGuidance";
import { REVIEW_ISSUE_CODES } from "../../src/domain/rules/vehiclePlReview";

/**
 * この画面の最優先要件は「仕様を知らない人でも何を入力すればよいか分かる」こと。
 * 指摘の種類が増えたときに説明文を書き忘れると、その指摘だけが
 * 「印は付いているが何をすればいいか分からない」状態になる。ここで機械的に塞ぐ。
 */
describe("issueGuidance", () => {
  const row = {
    trips: 12,
    km: 1858.3,
    hours: 7.1,
    slips: 30,
    sales: 0,
    salary: 0,
    fuelQty: 0,
    nempi: 42.5,
    toll: 1000,
    tollDisc: 5000,
    profit: -250000,
    expense: 900000,
    driver: "山田",
    code: "E001",
    type: "大型",
    depot: "本社",
  };

  it("すべての指摘の種類に、原因と対応の両方が用意されている", () => {
    for (const code of REVIEW_ISSUE_CODES) {
      const guidance = issueGuidance(
        { code, field: "km", value: 1858.3, reason: "テスト" },
        row,
      );
      expect(guidance.summary.length, code).toBeGreaterThan(10);
      expect(guidance.causes.length, code).toBeGreaterThan(0);
      expect(guidance.actions.length, code).toBeGreaterThan(0);
    }
  });

  it("説明文に実際の数字が入る (「閾値を超過」で終わらせない)", () => {
    const guidance = issueGuidance(
      { code: "sales_unlinked", field: "sales", value: 0, reason: "" },
      row,
    );
    expect(guidance.summary).toContain("12回");
    expect(guidance.summary).toContain("1,858.3km");
  });

  it("外れ値の説明では、ふつうの値との差が何倍かを言う", () => {
    const benchmark: ValueBenchmark = {
      typical: 900,
      typicalLabel: "大型の中央値",
      previous: 950,
      previousLabel: "先月(6月)",
    };
    const guidance = issueGuidance(
      { code: "anomaly", field: "km", value: 1800, reason: "" },
      row,
      benchmark,
      "稼働Km",
      "km",
    );
    expect(guidance.summary).toContain("大型の中央値");
    expect(guidance.summary).toContain("2.0倍ほど多い");
    expect(guidance.summary).toContain("桁が1つ違っている可能性");
  });

  it("比べる値が無くても説明は成立する", () => {
    const guidance = issueGuidance(
      { code: "anomaly", field: "km", value: 1800, reason: "" },
      row,
      EMPTY_BENCHMARK,
      "稼働Km",
      "km",
    );
    expect(guidance.summary).toContain("いつもの月と比べて外れた値");
  });

  it("3区分の意味が語ではなく文で用意されている", () => {
    expect(SEVERITY_MEANING.blocking).toContain("間違って");
    expect(SEVERITY_MEANING.warning).toContain("実態と違う");
    expect(SEVERITY_MEANING.info).toContain("直さなくて");
  });
});

/**
 * 入力中の判定。色だけで伝えないため、どの結論でも必ず本文が付くことを確かめる。
 */
describe("checkValue", () => {
  const benchmark: ValueBenchmark = {
    typical: 1000,
    typicalLabel: "大型の中央値",
    previous: null,
    previousLabel: "",
  };

  it("中央値の半分〜2倍はふつうの範囲とする", () => {
    expect(checkValue(500, benchmark).verdict).toBe("ok");
    expect(checkValue(1000, benchmark).verdict).toBe("ok");
    expect(checkValue(2000, benchmark).verdict).toBe("ok");
  });

  it("範囲を外れたら、大きいのか小さいのかを言う", () => {
    expect(checkValue(2001, benchmark).verdict).toBe("high");
    expect(checkValue(499, benchmark).verdict).toBe("low");
    expect(checkValue(2001, benchmark).message).toContain("大きい");
    expect(checkValue(499, benchmark).message).toContain("小さい");
  });

  it("金額に小数点を付けない (桁の話をしている画面で読みにくくなる)", () => {
    const yenBenchmark: ValueBenchmark = {
      typical: 1800000,
      typicalLabel: "大型の中央値",
      previous: null,
      previousLabel: "",
    };
    expect(checkValue(1800000, yenBenchmark, "円").message).toContain("約 1,800,000円");
  });

  it("比べる相手が無いときは判定しない (根拠のない○×を出さない)", () => {
    expect(checkValue(500, EMPTY_BENCHMARK).verdict).toBe("unknown");
    expect(checkValue(500, EMPTY_BENCHMARK).message).toBe("");
  });
});

/**
 * 桁違いはこの業務で実際に起きている入力ミス (異常検知にも digit_suspect がある)。
 * 「850,000 のことですか?」と候補を出せれば、押すだけで直る。
 */
describe("digitFixCandidate", () => {
  const benchmark = (typical: number): ValueBenchmark => ({
    typical,
    typicalLabel: "大型の中央値",
    previous: null,
    previousLabel: "",
  });

  it("10倍打ってしまった値には10分の1の候補を出す", () => {
    expect(digitFixCandidate(8_500_000, benchmark(900_000))).toBe(850_000);
  });

  it("10分の1に打ってしまった値には10倍の候補を出す", () => {
    expect(digitFixCandidate(85_000, benchmark(900_000))).toBe(850_000);
  });

  it("2倍程度のずれは桁の問題ではないので候補を出さない", () => {
    expect(digitFixCandidate(1_800_000, benchmark(900_000))).toBeNull();
  });

  it("比べる相手が無ければ候補を出さない", () => {
    expect(digitFixCandidate(8_500_000, EMPTY_BENCHMARK)).toBeNull();
  });

  it("0や負の値には候補を出さない", () => {
    expect(digitFixCandidate(0, benchmark(900_000))).toBeNull();
    expect(digitFixCandidate(-100, benchmark(900_000))).toBeNull();
  });
});
