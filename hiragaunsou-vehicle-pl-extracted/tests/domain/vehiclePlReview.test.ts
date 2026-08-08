import { describe, expect, it } from "vitest";
import {
  anomalyIssues,
  excelMismatchIssues,
  heaviestSeverity,
  overrideIssues,
  unlinkedTrailerIssues,
  reviewVehicleRow,
} from "../../src/domain/rules/vehiclePlReview";

/** 稼働していて、どの判定にも引っかからない健全な1台。 */
function healthy(overrides: Record<string, unknown> = {}) {
  return {
    no: "24",
    type: "大型",
    depot: "本社",
    driver: "山田",
    code: "1001",
    trips: 20,
    slips: 40,
    hours: 180,
    km: 8000,
    sales: 1_200_000,
    toll: 80_000,
    tollDisc: 28_000,
    fuelQty: 2500,
    fuelTotal: 350_000,
    nempi: 3.2,
    salary: 400_000,
    insTotal: 20_000,
    taxTotal: 15_000,
    transportTotal: 100_000,
    fixed: 135_000,
    expense: 1_000_000,
    profit: 200_000,
    ...overrides,
  };
}

describe("reviewVehicleRow", () => {
  it("欠落も矛盾も無ければ何も指摘しない", () => {
    expect(reviewVehicleRow(healthy(), "2026-05")).toEqual([]);
  });

  /**
   * 「入れたらほぼ完成」を成立させるには、値が入っていないことより
   * 「なぜ入っていないか」が分かることのほうが重要になる。
   * 売上0は取込漏れではなく紐付け漏れで起きるため、稼働の実績を判断材料として添える。
   */
  it("稼働しているのに売上が無い車両は、稼働実績を添えて確定を止める", () => {
    const [issue] = reviewVehicleRow(healthy({ sales: 0, profit: -1_000_000 }), "2026-05");

    expect(issue).toMatchObject({ field: "sales", code: "sales_unlinked", severity: "blocking" });
    expect(issue?.comparisons).toEqual([
      { label: "運行回数", value: 20 },
      { label: "稼働Km", value: 8000 },
      { label: "伝票件数", value: 40 },
    ]);
    expect(issue?.fix?.href).toBe("/cleansing?ym=2026-05");
  });

  it("稼働しているのに給与が0なら、運転者マスタの紐付けを疑わせる", () => {
    const issues = reviewVehicleRow(healthy({ salary: 0, driver: null, code: null }), "2026-05");

    expect(issues.map((i) => i.code)).toContain("payroll_unlinked");
    const issue = issues.find((i) => i.code === "payroll_unlinked");
    expect(issue?.comparisons).toContainEqual({ label: "運転者名", value: null });
  });

  /**
   * 稼働ゼロの車両(車検中・遊休)にまで欠落の印を付けると、印だらけになって
   * 「印の付いたセルだけ見る」という運用そのものが壊れる。
   */
  it("稼働していない車両には欠落の印を付けない", () => {
    const idle = healthy({
      trips: 0, hours: 0, km: 0, sales: 0, salary: 0, fuelQty: 0, fuelTotal: 0, profit: 0,
    });

    expect(reviewVehicleRow(idle, "2026-05").map((i) => i.code)).toEqual([]);
  });

  it("保険・税・リースが揃って0なら車両マスタ未登録として知らせる", () => {
    const issues = reviewVehicleRow(
      healthy({ insTotal: 0, taxTotal: 0, transportTotal: 0, fixed: 0 }),
      "2026-05",
    );

    expect(issues.map((i) => i.code)).toContain("vehicle_master_missing");
  });

  it("燃費が現実的な範囲を外れたら、走行距離と給油量を並べて示す", () => {
    const issue = reviewVehicleRow(healthy({ nempi: 32 }), "2026-05").find(
      (i) => i.code === "nempi_out_of_range",
    );

    expect(issue?.severity).toBe("warning");
    expect(issue?.comparisons.map((c) => c.label)).toEqual(["稼働Km", "給油量合計", "妥当な範囲"]);
  });

  it("高速割引が通行料を超える矛盾を拾う", () => {
    const issue = reviewVehicleRow(healthy({ toll: 10_000, tollDisc: 30_000 }), "2026-05").find(
      (i) => i.code === "toll_discount_exceeds",
    );

    expect(issue?.field).toBe("tollDisc");
  });

  /**
   * 赤字の大半は入力漏れが原因で、原因を直すまでは赤字という結論に意味がない。
   * 原因と結果を同時に出すと、人は結果のほうを見て「この車は赤字だ」と誤読する。
   */
  it("入力の欠落がある車両では、赤字を別の所見として重ねない", () => {
    const codes = reviewVehicleRow(healthy({ sales: 0, profit: -900_000 }), "2026-05").map((i) => i.code);

    expect(codes).toContain("sales_unlinked");
    expect(codes).not.toContain("deficit");
  });

  it("欠落が無い赤字は、実力としての赤字だと分かる形で示す", () => {
    const [issue] = reviewVehicleRow(healthy({ profit: -50_000, expense: 1_250_000 }), "2026-05");

    expect(issue).toMatchObject({ code: "deficit", severity: "info" });
    expect(issue?.comparisons).toEqual([
      { label: "運送収入", value: 1_200_000 },
      { label: "経費計", value: 1_250_000 },
    ]);
  });
});

describe("excelMismatchIssues", () => {
  /**
   * どちらが正しいかは機械には決められない。だから判定せず、両方の値を並べる。
   * ここを blocking にすると「Excelに合わせろ」という指示になってしまう。
   */
  it("Excelとの差は判定せず、両方の値を並べて人に選ばせる", () => {
    const [issue] = excelMismatchIssues(
      {
        vehicles: [
          { vehicleNo: "10", items: [{ field: "fare", label: "運賃", excel: 900_000, system: 1_050_000, diff: 150_000 }] },
        ],
      },
      "2026-05",
    );

    expect(issue).toMatchObject({ vehicleNo: "10", field: "fare", severity: "info" });
    expect(issue?.title).toBe("Excelと +150,000円 違います");
    expect(issue?.comparisons).toEqual([
      { label: "Excelの値", value: 900_000 },
      { label: "このシステムの値", value: 1_050_000 },
      { label: "差 (システム − Excel)", value: 150_000 },
    ]);
  });
});

describe("anomalyIssues", () => {
  it("比較した相手の値を添えて例月乖離を伝える", () => {
    const [issue] = anomalyIssues(
      [
        {
          vehicleNo: "24",
          field: "fuelTotal",
          type: "digit_suspect",
          message: "fuelTotal が例月中央値(300000)の10.0倍相当で桁ミスの疑いがあります",
          monthlyReference: 300_000,
          value: 3_000_000,
        },
      ],
      "2026-05",
    );

    expect(issue?.severity).toBe("warning");
    expect(issue?.comparisons).toEqual([
      { label: "例月中央値", value: 300_000 },
      { label: "この月の値", value: 3_000_000 },
    ]);
  });

  it("比較する相手が無いフラグでは判断材料を空にする(嘘の根拠を作らない)", () => {
    const [issue] = anomalyIssues(
      [{ vehicleNo: "24", field: "km", type: "missing_input", message: "未入力です", monthlyReference: null, value: null }],
      "2026-05",
    );

    expect(issue?.comparisons).toEqual([]);
  });
});

describe("overrideIssues", () => {
  const rows = new Map([["10", { vehicleNo: "10" }]]);

  /**
   * 上書きは指摘ではなく「人が確認済み」の印。赤や黄で出すと、直したはずの行が
   * 毎月「要確認」として並び、印そのものが信用されなくなる。
   */
  it("人が直した項目に、理由と出どころを添えた参考の印を付ける", () => {
    const [issue] = overrideIssues(
      [
        {
          vehicleNo: "10",
          excluded: false,
          values: { fare: 900000 },
          reason: "請求側で15万円減額",
          updatedByName: "今西",
        },
      ],
      rows,
      "2026-05",
    );

    expect(issue?.severity).toBe("info");
    expect(issue?.field).toBe("fare");
    expect(issue?.reason).toBe("請求側で15万円減額");
    expect(issue?.comparisons).toEqual([
      { label: "いまの値(上書き後)", value: 900000 },
      { label: "本来の出どころ", value: "売上モニタリスト" },
      { label: "直した人", value: "今西" },
    ]);
    expect(issue?.fix?.href).toBe("/vehicle/10?ym=2026-05");
  });

  it("収支表から外した車両には印を付けない(そもそも行が無い)", () => {
    expect(
      overrideIssues(
        [{ vehicleNo: "303", excluded: true, values: {}, reason: "5月は稼働なし" }],
        rows,
        "2026-05",
      ),
    ).toEqual([]);
  });

  it("表に載っていない車両の上書きは印にしない(存在しない行を指さない)", () => {
    expect(
      overrideIssues(
        [{ vehicleNo: "999", excluded: false, values: { fare: 1 }, reason: "テスト" }],
        rows,
        "2026-05",
      ),
    ).toEqual([]);
  });
});

describe("heaviestSeverity", () => {
  it("行の代表色を決めるため、最も重い所見を返す", () => {
    const issues = [
      { severity: "info" as const },
      { severity: "blocking" as const },
      { severity: "warning" as const },
    ] as Parameters<typeof heaviestSeverity>[0];

    expect(heaviestSeverity(issues)).toBe("blocking");
  });

  it("所見が無ければ色を付けない", () => {
    expect(heaviestSeverity([])).toBeNull();
  });
});

describe("unlinkedTrailerIssues", () => {
  /**
   * 統合されたトレーラの行は finalize が消しているので、収支表に残っていること自体が
   * 「けん引先が未登録」の印になる。106行と101行の差はここでしか気づけない。
   */
  it("単独で残っているトレーラを、けん引先の登録を促す指摘にする", () => {
    const issues = unlinkedTrailerIssues(
      [
        { vehicleNo: "1113", type: "被けん引車", sales: 0, expense: 18000 },
        { vehicleNo: "129", type: "セミトレ", sales: 1_275_825, expense: 1_141_068 },
      ],
      "2026-05",
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.vehicleNo).toBe("1113");
    expect(issues[0]?.code).toBe("trailer_unlinked");
    // 計算は壊れていないので blocking にはしない (単独運用の車両で作業を止めない)
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.fix?.href).toContain("/admin/vehicle-master");
  });

  it("判断材料として、その行の運送収入と経費計を並べる", () => {
    const issues = unlinkedTrailerIssues(
      [{ vehicleNo: "1113", type: "被けん引車", sales: 0, expense: 18000 }],
      "2026-05",
    );

    expect(issues[0]?.comparisons).toEqual([
      { label: "この行の運送収入", value: 0 },
      { label: "この行の経費計", value: 18000 },
      { label: "車種名", value: "被けん引車" },
    ]);
  });

  it("トレーラでない車両は指摘しない", () => {
    expect(
      unlinkedTrailerIssues([{ vehicleNo: "101", type: "4tウイング", sales: 0, expense: 0 }], "2026-05"),
    ).toEqual([]);
  });
});
