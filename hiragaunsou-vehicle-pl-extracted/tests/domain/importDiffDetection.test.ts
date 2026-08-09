import { describe, expect, it } from "vitest";
import {
  detectDuplicateCandidates,
  detectImportDiffs,
  detectNearMatches,
  excludeAcked,
  importDiffFingerprint,
  isDigitJump,
  sortImportDiffs,
  type ComparableRecord,
} from "../../src/domain/rules/importDiffDetection";

/** 運転者1名ぶんのテストデータ */
function driver(
  employeeCode: string,
  driverName: string,
  vehicleNo: string,
): ComparableRecord {
  return {
    key: employeeCode,
    label: driverName,
    fields: [
      { field: "driverName", fieldLabel: "氏名", value: driverName, kind: "name" },
      { field: "vehicleNo", fieldLabel: "乗っている車", value: vehicleNo, kind: "id" },
    ],
  };
}

/** 車両1台ぶんのテストデータ */
function vehicle(vehicleNo: string, lease: string): ComparableRecord {
  return {
    key: vehicleNo,
    label: `車番 ${vehicleNo}`,
    fields: [
      { field: "lease", fieldLabel: "リース料", value: lease, kind: "amount" },
    ],
  };
}

const detect = (previous: ComparableRecord[], current: ComparableRecord[]) =>
  detectImportDiffs({ previous, current, targetKind: "driver" });

describe("表記のゆれだけの差は出さない", () => {
  it("姓名の間の空白が変わっただけならアラートにしない", () => {
    const { diffs, absorbed } = detect([driver("1", "田中 一郎", "101")], [driver("1", "田中一郎", "101")]);
    expect(diffs).toHaveLength(0);
    // 出さないが、裏には残す
    expect(absorbed).toHaveLength(1);
    expect(absorbed[0]).toMatchObject({ field: "driverName", before: "田中 一郎", after: "田中一郎" });
  });

  it("車番のゼロ埋めが変わっただけならアラートにしない", () => {
    const { diffs, absorbed } = detect([driver("1", "田中一郎", "0101")], [driver("1", "田中一郎", "101")]);
    expect(diffs).toHaveLength(0);
    expect(absorbed).toHaveLength(1);
  });

  it("金額のカンマ・円記号・全角の書き分けはアラートにしない", () => {
    const { diffs, absorbed } = detectImportDiffs({
      previous: [vehicle("101", "100,000")],
      current: [vehicle("101", "￥100000")],
      targetKind: "vehicle",
    });
    expect(diffs).toHaveLength(0);
    expect(absorbed).toHaveLength(1);
  });
});

describe("実質的な変更は「前回と異なります」として出す", () => {
  it("氏名が変わったら出す", () => {
    const { diffs } = detect([driver("1", "田中一郎", "101")], [driver("1", "佐藤次郎", "101")]);
    const d = diffs.find((x) => x.field === "driverName");
    expect(d).toBeDefined();
    expect(d).toMatchObject({ kind: "value_changed", before: "田中一郎", after: "佐藤次郎" });
  });

  it("乗る車が変わったら紐付けの変更として出す (人事異動はふつうのこと)", () => {
    const { diffs } = detect([driver("1", "田中一郎", "101")], [driver("1", "田中一郎", "202")]);
    const d = diffs.find((x) => x.field === "vehicleNo");
    expect(d).toMatchObject({ kind: "link_changed", severity: "caution" });
  });

  it("車番が外れて未割当になったら強く出す", () => {
    const { diffs } = detect([driver("1", "田中一郎", "101")], [driver("1", "田中一郎", "")]);
    const d = diffs.find((x) => x.field === "vehicleNo");
    expect(d).toMatchObject({ kind: "unassigned", severity: "critical" });
  });

  it("金額の桁が違ったら強く出す", () => {
    const { diffs } = detectImportDiffs({
      previous: [vehicle("101", "100000")],
      current: [vehicle("101", "1000000")],
      targetKind: "vehicle",
    });
    expect(diffs[0]).toMatchObject({ kind: "digit_jump", severity: "critical" });
  });

  it("金額が常識的な幅で変わったのはふつうの変更として出す", () => {
    const { diffs } = detectImportDiffs({
      previous: [vehicle("101", "100000")],
      current: [vehicle("101", "105000")],
      targetKind: "vehicle",
    });
    expect(diffs[0]).toMatchObject({ kind: "value_changed", severity: "caution" });
  });

  it("空欄になったのは0円ではなく入力漏れかもしれないので出す", () => {
    const { diffs } = detectImportDiffs({
      previous: [vehicle("101", "100000")],
      current: [vehicle("101", "")],
      targetKind: "vehicle",
    });
    expect(diffs).toHaveLength(1);
  });
});

describe("前回あって今回消えた行", () => {
  it("消えた行を強く出す (消したのか渡し漏れたのか機械では決められない)", () => {
    const { diffs } = detect(
      [driver("1", "田中一郎", "101"), driver("2", "佐藤次郎", "202")],
      [driver("1", "田中一郎", "101")],
    );
    const removed = diffs.find((d) => d.kind === "row_removed");
    expect(removed).toMatchObject({ severity: "critical", targetLabel: "佐藤次郎" });
  });

  it("今回増えた行はふつうの扱いで出す", () => {
    const { diffs } = detect([driver("1", "田中一郎", "101")], [
      driver("1", "田中一郎", "101"),
      driver("2", "佐藤次郎", "202"),
    ]);
    const added = diffs.find((d) => d.kind === "row_added");
    expect(added).toMatchObject({ severity: "caution", targetLabel: "佐藤次郎" });
  });

  it("はじめての取込では全件を差分にしない", () => {
    const { diffs } = detect([], [driver("1", "田中一郎", "101"), driver("2", "佐藤次郎", "202")]);
    expect(diffs.filter((d) => d.kind === "row_added")).toHaveLength(0);
  });
});

describe("二重登録の検出", () => {
  it("書き方だけ違う同じ名前が2件あれば「同じものが2件あります」を出す", () => {
    const diffs = detectDuplicateCandidates(
      [driver("1", "田中 一郎", "101"), driver("2", "田中一郎", "202")],
      "driver",
    );
    const dup = diffs.find((d) => d.kind === "duplicate_candidate");
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe("critical");
    expect(dup?.counterpartLabel).toBe("田中一郎");
  });

  it("正規化すると重なる識別子も二重登録として出す (001 と 1)", () => {
    const diffs = detectDuplicateCandidates([driver("001", "田中一郎", "101"), driver("1", "佐藤次郎", "202")], "driver");
    expect(diffs.some((d) => d.kind === "duplicate_candidate")).toBe(true);
  });

  it("別人が2件並んでいるだけなら出さない", () => {
    const diffs = detectDuplicateCandidates([driver("1", "田中一郎", "101"), driver("2", "佐藤次郎", "202")], "driver");
    expect(diffs).toHaveLength(0);
  });
});

describe("もしかして同じ? の候補", () => {
  it("1文字違いは候補として出すだけで、自動では同じにしない", () => {
    const diffs = detectNearMatches([driver("1", "田中一郎", "101"), driver("2", "田仲一郎", "202")], "driver");
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ kind: "near_match", severity: "caution" });
  });

  it("まったく違う名前は候補にしない", () => {
    const diffs = detectNearMatches([driver("1", "田中一郎", "101"), driver("2", "佐藤次郎", "202")], "driver");
    expect(diffs).toHaveLength(0);
  });
});

describe("文字化け", () => {
  it("化けていそうな氏名は前回を待たずに強く出す", () => {
    const broken = driver("1", "���", "101");
    const { diffs } = detect([], [broken]);
    expect(diffs.some((d) => d.kind === "mojibake" && d.severity === "critical")).toBe(true);
  });
});

describe("確認済みにした差分は次から出さない", () => {
  it("指紋が一致するものを取り除く", () => {
    const { diffs } = detect([driver("1", "田中一郎", "101")], [driver("1", "佐藤次郎", "101")]);
    const acked = new Set(diffs.map((d) => d.fingerprint));
    expect(excludeAcked(diffs, acked)).toHaveLength(0);
  });

  it("同じ箇所でも値が変わればまた出る (一度OKは以後ずっとOKではない)", () => {
    const first = detect([driver("1", "田中一郎", "101")], [driver("1", "佐藤次郎", "101")]);
    const acked = new Set(first.diffs.map((d) => d.fingerprint));
    const second = detect([driver("1", "佐藤次郎", "101")], [driver("1", "鈴木三郎", "101")]);
    expect(excludeAcked(second.diffs, acked).length).toBeGreaterThan(0);
  });

  it("指紋は書き方のゆれで変わらない", () => {
    const a = importDiffFingerprint({
      targetKind: "driver",
      targetKey: "1",
      kind: "value_changed",
      field: "driverName",
      before: "田中 一郎",
      after: "佐藤次郎",
    });
    const b = importDiffFingerprint({
      targetKind: "driver",
      targetKey: "1",
      kind: "value_changed",
      field: "driverName",
      before: "田中一郎",
      after: "佐藤次郎",
    });
    expect(a).toBe(b);
  });
});

describe("並び順と桁違いの判定", () => {
  it("強く出すものが先に並ぶ", () => {
    const { diffs } = detect(
      [driver("1", "田中一郎", "101"), driver("2", "佐藤次郎", "202")],
      [driver("1", "山田四郎", "101")],
    );
    expect(sortImportDiffs(diffs)[0]?.severity).toBe("critical");
  });

  it("0円との出入りは桁違いとは呼ばない", () => {
    expect(isDigitJump(0, 100000)).toBe(false);
    expect(isDigitJump(100000, 1000000)).toBe(true);
    expect(isDigitJump(100000, 105000)).toBe(false);
  });
});
