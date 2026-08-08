import { describe, expect, it } from "vitest";
import {
  applyIssueAcks,
  openIssues,
  plIssueKey,
  type PlIssueAckRecord,
} from "../../src/domain/rules/plIssueAck";
import type { VehiclePlIssue } from "../../src/domain/rules/vehiclePlReview";

function issue(over: Partial<VehiclePlIssue> = {}): VehiclePlIssue {
  return {
    vehicleNo: "10",
    field: "fare",
    code: "anomaly",
    severity: "warning",
    title: "運賃が例月と大きく違います",
    reason: "例月中央値の2.1倍です",
    value: 900_000,
    comparisons: [],
    fix: null,
    ...over,
  };
}

function ack(over: Partial<PlIssueAckRecord> = {}): PlIssueAckRecord {
  return {
    vehicleNo: "10",
    field: "fare",
    code: "anomaly",
    note: null,
    ackedAt: new Date(2026, 4, 20, 10, 0, 0),
    ackedByName: "今西",
    ...over,
  };
}

describe("plIssueKey", () => {
  /**
   * 指摘そのものはDBに無く表示のたびに導出されるので、この4つ組だけが指摘を指す手段になる。
   * 画面・API・DBで組み立て方がずれると、確認済みにした印が二度と一致しなくなる。
   */
  it("車番・列・指摘の種類の3つで1件を指す", () => {
    expect(plIssueKey({ vehicleNo: "10", field: "fare", code: "anomaly" })).toBe(
      "10::fare::anomaly",
    );
  });

  it("同じ車両でも列が違えば別の指摘として扱う", () => {
    expect(plIssueKey({ vehicleNo: "10", field: "fare", code: "anomaly" })).not.toBe(
      plIssueKey({ vehicleNo: "10", field: "km", code: "anomaly" }),
    );
  });
});

describe("applyIssueAcks", () => {
  it("印が付いている指摘だけを確認済みにし、誰がいつ確認したかを添える", () => {
    const reviewed = applyIssueAcks(
      [issue(), issue({ field: "km", code: "nempi_out_of_range" })],
      [ack()],
    );

    expect(reviewed[0]?.acknowledged).toBe(true);
    expect(reviewed[0]?.ack).toEqual({
      note: null,
      ackedAt: new Date(2026, 4, 20, 10, 0, 0).getTime(),
      ackedByName: "今西",
    });
    expect(reviewed[1]?.acknowledged).toBe(false);
    expect(reviewed[1]?.ack).toBeNull();
  });

  /**
   * 「値が1円でも動いたら確認済みを外す」とはしない。丸めの修正でも確認作業が振り出しに戻り、
   * いつまでも確認が終わらなくなるため。印は指摘そのものが消えたときに自然に消える。
   */
  it("値が変わっても、同じ指摘が残っている限り確認済みのまま", () => {
    const reviewed = applyIssueAcks([issue({ value: 900_001 })], [ack()]);
    expect(reviewed[0]?.acknowledged).toBe(true);
  });

  it("指摘が消えれば印は画面に出ない(印の消し込みは不要)", () => {
    expect(applyIssueAcks([], [ack()])).toEqual([]);
  });

  /** 翌月は別の年月として保存されるので、先月の印は今月に効かない (毎月ゼロから確認する)。 */
  it("他の車両の印は流用されない", () => {
    const reviewed = applyIssueAcks([issue({ vehicleNo: "11" })], [ack({ vehicleNo: "10" })]);
    expect(reviewed[0]?.acknowledged).toBe(false);
  });
});

describe("openIssues", () => {
  it("まだ確認していない指摘だけを残す(残り件数とセルの色はこれで決まる)", () => {
    const reviewed = applyIssueAcks(
      [issue(), issue({ field: "km", code: "nempi_out_of_range" })],
      [ack()],
    );
    expect(openIssues(reviewed).map((i) => i.field)).toEqual(["km"]);
  });
});
