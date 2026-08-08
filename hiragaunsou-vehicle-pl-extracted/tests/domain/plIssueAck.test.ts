import { describe, expect, it } from "vitest";
import {
  applyIssueAcks,
  canCarryOver,
  openIssues,
  plIssueKey,
  postponedIssues,
  untouchedIssues,
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
    status: "ok",
    note: null,
    valueAtAck: 900_000,
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
      status: "ok",
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

  /**
   * 翌月は別の年月として保存されるので、先月の印がそのまま「確認済み」になることはない
   * (先月OKだった指摘は案内として出るだけ。§carriedOver を参照)。
   */
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

describe("あとで見る (後回し)", () => {
  /**
   * 「あとで見る」は判断を保留した状態であって、確認が済んだ状態ではない。
   * ここを acknowledged 側に寄せると、残り件数から消えて後回しが行方不明になる。
   */
  it("後回しは確認済みにならず、残り件数に入ったままになる", () => {
    const reviewed = applyIssueAcks([issue()], [ack({ status: "later" })]);

    expect(reviewed[0]?.acknowledged).toBe(false);
    expect(reviewed[0]?.postponed).toBe(true);
    expect(openIssues(reviewed)).toHaveLength(1);
    expect(postponedIssues(reviewed)).toHaveLength(1);
  });

  it("まだ何も判断していない指摘とは区別する(最初に見る対象から後回しを外す)", () => {
    const reviewed = applyIssueAcks(
      [issue(), issue({ field: "km", code: "nempi_out_of_range" })],
      [ack({ status: "later" })],
    );
    expect(untouchedIssues(reviewed).map((i) => i.field)).toEqual(["km"]);
  });
});

describe("canCarryOver", () => {
  it("値がほぼ同じなら先月の判断を持ち込める", () => {
    expect(canCarryOver(1_000_000, 1_100_000)).toBe(true);
  });

  /** 2割を超えて動いていたら「先月OKにした理由」がそのまま通るとは限らない。 */
  it("値が2割を超えて動いていたら持ち込まない", () => {
    expect(canCarryOver(1_000_000, 1_300_000)).toBe(false);
  });

  it("先月の値が記録されていなければ持ち込まない(比べようがないため)", () => {
    expect(canCarryOver(null, 1_000_000)).toBe(false);
  });

  it("今月の値が数値でなければ持ち込まない", () => {
    expect(canCarryOver(1_000_000, "—")).toBe(false);
  });
});

describe("先月の判断の引き継ぎ (carriedOver)", () => {
  it("先月OKにした指摘には案内を出すが、勝手に確認済みにはしない", () => {
    const reviewed = applyIssueAcks([issue()], [], [ack()]);

    expect(reviewed[0]?.acknowledged).toBe(false);
    expect(reviewed[0]?.carriedOver).toEqual({
      previousValue: 900_000,
      ackedByName: "今西",
      ackedAt: new Date(2026, 4, 20, 10, 0, 0).getTime(),
    });
  });

  it("先月が「あとで見る」だったものは引き継がない(判断していないため)", () => {
    const reviewed = applyIssueAcks([issue()], [], [ack({ status: "later" })]);
    expect(reviewed[0]?.carriedOver).toBeNull();
  });

  it("今月すでに判断している指摘には先月の話を重ねない", () => {
    const reviewed = applyIssueAcks([issue()], [ack()], [ack()]);
    expect(reviewed[0]?.carriedOver).toBeNull();
  });

  it("値が大きく動いた指摘は引き継がない", () => {
    const reviewed = applyIssueAcks([issue({ value: 1_500_000 })], [], [ack()]);
    expect(reviewed[0]?.carriedOver).toBeNull();
  });
});
