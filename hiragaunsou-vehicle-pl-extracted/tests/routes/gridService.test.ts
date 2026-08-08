import { describe, expect, it } from "vitest";
import { buildGridResponse } from "../../src/usecase/steps/getMonthlyGrid";
import type { AnomalyFlag } from "../../src/domain/rules/anomalyDetection";

describe("buildGridResponse", () => {
  it("51列すべてをfieldsとして返す", () => {
    const res = buildGridResponse("2026-05", [], []);
    expect(res.fields).toHaveLength(51);
    expect(res.fields).toContain("profit");
    expect(res.fields).toContain("margin");
  });

  it("データが無い場合 isEmpty=true", () => {
    const res = buildGridResponse("2026-05", [], []);
    expect(res.isEmpty).toBe(true);
  });

  it("異常検知フラグの対象フィールドを highlightedFields に反映する", () => {
    const flags: AnomalyFlag[] = [
      {
        vehicleNo: "1",
        field: "repair",
        type: "digit_suspect",
        message: "桁ミス疑い",
        monthlyReference: 1000,
        value: 999999,
      },
    ];
    const res = buildGridResponse(
      "2026-05",
      [{ vehicleNo: "1", repair: 999999 }],
      flags,
    );
    expect(res.rows[0].highlightedFields).toEqual(["repair"]);
  });

  it("フラグの無い車両はhighlightedFieldsが空配列", () => {
    const res = buildGridResponse("2026-05", [{ vehicleNo: "2" }], []);
    expect(res.rows[0].highlightedFields).toEqual([]);
  });
});

/**
 * 「確認しました。このままでよい」と判断した指摘は、残りの件数から外れて確認作業が前に進む。
 * 逆に外れないと、直しようのない指摘 (例: 実力として赤字) が毎月ずっと残り続ける。
 */
describe("buildGridResponse の確認済み", () => {
  const flags: AnomalyFlag[] = [
    {
      vehicleNo: "1",
      field: "repair",
      type: "digit_suspect",
      message: "桁ミス疑い",
      monthlyReference: 1000,
      value: 999999,
    },
  ];
  const plRows = [{ vehicleNo: "1", repair: 999999 }];

  it("確認済みにした指摘は残り件数から外れ、確認済みとして数える", () => {
    const before = buildGridResponse("2026-05", plRows, flags);
    const target = before.rows[0].issues[0];
    expect(target).toBeDefined();
    expect(before.review.acknowledged).toBe(0);

    const after = buildGridResponse("2026-05", plRows, flags, undefined, [], [
      {
        vehicleNo: target.vehicleNo,
        field: target.field,
        code: target.code,
        status: "ok" as const,
        note: null,
        valueAtAck: 999999,
        ackedAt: new Date(2026, 4, 20),
        ackedByName: "今西",
      },
    ]);

    const openBefore = before.review.blocking + before.review.warning + before.review.info;
    const openAfter = after.review.blocking + after.review.warning + after.review.info;
    expect(openAfter).toBe(openBefore - 1);
    expect(after.review.acknowledged).toBe(1);
    expect(after.rows[0].issues[0].acknowledged).toBe(true);
    expect(after.rows[0].issues[0].ack?.ackedByName).toBe("今西");
  });

  /** 行の色は「まだ確認していない指摘」で決める。済んだ行が赤いままだと残りが見えなくなる。 */
  it("すべて確認済みになった行は色が付かなくなる", () => {
    const before = buildGridResponse("2026-05", plRows, flags);
    const acks = before.rows[0].issues.map((issue) => ({
      vehicleNo: issue.vehicleNo,
      field: issue.field,
      code: issue.code,
      status: "ok" as const,
      note: null,
      valueAtAck: null,
      ackedAt: new Date(2026, 4, 20),
      ackedByName: "今西",
    }));

    const after = buildGridResponse("2026-05", plRows, flags, undefined, [], acks);
    expect(before.rows[0].severity).not.toBeNull();
    expect(after.rows[0].severity).toBeNull();
  });

  /** 直したのに反映していない件数が見えないと、古い数字のまま確定してしまう。 */
  it("収支表へ反映していない直しの件数を返す", () => {
    const res = buildGridResponse("2026-05", plRows, [], undefined, [
      {
        vehicleNo: "1",
        excluded: false,
        values: { repair: 9999 },
        reason: "桁の打ち間違い",
        updatedAt: new Date(2026, 4, 20, 10),
        updatedByName: "今西",
        appliedAt: null,
      },
    ]);

    expect(res.review.pendingOverrides).toBe(1);
    expect(res.rows[0].override?.pending).toBe(true);
    expect(res.rows[0].override?.values).toEqual({ repair: 9999 });
  });

  it("反映済みの直しは反映待ちに数えない", () => {
    const res = buildGridResponse("2026-05", plRows, [], undefined, [
      {
        vehicleNo: "1",
        excluded: false,
        values: { repair: 9999 },
        reason: "桁の打ち間違い",
        updatedAt: new Date(2026, 4, 20, 10),
        updatedByName: "今西",
        appliedAt: new Date(2026, 4, 20, 11),
      },
    ]);

    expect(res.review.pendingOverrides).toBe(0);
    expect(res.rows[0].override?.pending).toBe(false);
  });
});

/**
 * 「ふつうはこのくらい」の材料。指摘の付いた項目だけに付き、
 * 何と比べた値なのか (同じ車種か・全車両か・先月か) がラベルで分かることを固定する。
 * ここが空だと、確認画面は「多すぎます」とだけ言って根拠を出せない画面になる。
 */
describe("buildGridResponse のふつうはこのくらい", () => {
  const flags: AnomalyFlag[] = [
    {
      vehicleNo: "1",
      field: "repair",
      type: "digit_suspect",
      message: "桁ミス疑い",
      monthlyReference: 1000,
      value: 999999,
    },
  ];

  it("同じ車種が3台以上あれば、その車種の中央値と比べる", () => {
    const res = buildGridResponse(
      "2026-05",
      [
        { vehicleNo: "1", type: "大型", repair: 999999 },
        { vehicleNo: "2", type: "大型", repair: 1000 },
        { vehicleNo: "3", type: "大型", repair: 2000 },
        { vehicleNo: "4", type: "大型", repair: 3000 },
      ],
      flags,
    );

    expect(res.rows[0].benchmarks.repair).toMatchObject({
      typical: 2500,
      typicalLabel: "大型の中央値",
    });
  });

  it("同じ車種が3台に満たなければ全車両に広げ、そのことをラベルに書く", () => {
    const res = buildGridResponse(
      "2026-05",
      [
        { vehicleNo: "1", type: "大型", repair: 999999 },
        { vehicleNo: "2", type: "大型", repair: 1000 },
        { vehicleNo: "3", type: "中型", repair: 2000 },
        { vehicleNo: "4", type: "中型", repair: 3000 },
      ],
      flags,
    );

    expect(res.rows[0].benchmarks.repair).toMatchObject({
      typical: 2500,
      typicalLabel: "全車両の中央値",
    });
  });

  it("先月の同じ車両・同じ項目の値を添える", () => {
    const res = buildGridResponse(
      "2026-05",
      [
        { vehicleNo: "1", type: "大型", repair: 999999 },
        { vehicleNo: "2", type: "大型", repair: 1000 },
        { vehicleNo: "3", type: "大型", repair: 2000 },
      ],
      flags,
      undefined,
      [],
      [],
      [{ no: "1", repair: 1200 }],
    );

    const benchmark = res.rows[0].benchmarks.repair;
    expect(benchmark?.previous).toBe(1200);
    expect(benchmark?.previousLabel).toContain("先月");
  });

  it("先月のデータが無ければ先月の値は付けない", () => {
    const res = buildGridResponse(
      "2026-05",
      [
        { vehicleNo: "1", type: "大型", repair: 999999 },
        { vehicleNo: "2", type: "大型", repair: 1000 },
        { vehicleNo: "3", type: "大型", repair: 2000 },
      ],
      flags,
    );

    expect(res.rows[0].benchmarks.repair?.previous).toBeNull();
    expect(res.rows[0].benchmarks.repair?.previousLabel).toBe("");
  });

  it("比べる材料がひとつも無い項目には作らない (空の見出しを画面に出さない)", () => {
    const res = buildGridResponse(
      "2026-05",
      [
        { vehicleNo: "1", type: "大型", repair: 0 },
        { vehicleNo: "2", type: "大型", repair: 0 },
      ],
      flags,
    );

    expect(res.rows[0].benchmarks.repair).toBeUndefined();
  });

  it("指摘の無い項目には作らない (106台×51列ぶんを送らない)", () => {
    const res = buildGridResponse(
      "2026-05",
      [
        { vehicleNo: "1", type: "大型", repair: 999999, km: 1800 },
        { vehicleNo: "2", type: "大型", repair: 1000, km: 900 },
        { vehicleNo: "3", type: "大型", repair: 2000, km: 950 },
      ],
      flags,
    );

    expect(res.rows[0].benchmarks.km).toBeUndefined();
  });
});

/**
 * 運送収入は「運賃 − 手数料」の計算結果なので、収入0の指摘に対して直すのは運賃側。
 * 入口側の「ふつうはこのくらい」が無いと、入力欄に例も判定も出せない。
 */
describe("buildGridResponse の直す入口の項目", () => {
  it("運送収入0の指摘には、運賃の「ふつうはこのくらい」も付ける", () => {
    const res = buildGridResponse(
      "2026-05",
      [
        { vehicleNo: "1", type: "大型", trips: 12, km: 1858, sales: 0, fare: 0 },
        { vehicleNo: "2", type: "大型", trips: 20, km: 9000, sales: 1800000, fare: 1800000 },
        { vehicleNo: "3", type: "大型", trips: 20, km: 9000, sales: 1600000, fare: 1600000 },
        { vehicleNo: "4", type: "大型", trips: 20, km: 9000, sales: 1400000, fare: 1400000 },
      ],
      [],
    );

    expect(res.rows[0].issues.some((i) => i.code === "sales_unlinked")).toBe(true);
    expect(res.rows[0].benchmarks.fare?.typical).toBe(1600000);
  });
});
