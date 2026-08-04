import { describe, expect, it } from "vitest";
import { assertRequiredHeaders, parseCsv, toRecords } from "../../src/infrastructure/parsers/csvUtils";

describe("parseCsv (RFC4180準拠の最小CSVパーサ)", () => {
  it("ダブルクォート内のエスケープされた \"\" を1個の \" として復元する", () => {
    const csv = '見出し\n"彼は""了解""と言った"\n';
    const rows = parseCsv(csv);
    expect(rows).toEqual([["見出し"], ['彼は"了解"と言った']]);
  });

  it("ダブルクォート内のカンマ・改行はフィールド区切りとして扱わない", () => {
    const csv = '車番,備考\n"4242","東京,大阪\n両方経由"\n';
    const rows = parseCsv(csv);
    expect(rows[1]).toEqual(["4242", "東京,大阪\n両方経由"]);
  });

  it("改行コードの揺れ(\\r\\n, \\r)を吸収する", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\r1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("末尾に改行が無いファイルでも最終行を取りこぼさない", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("空文字列の入力は空配列を返す", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("assertRequiredHeaders", () => {
  it("必須列(単一列名)が全て揃っていれば例外を投げない", () => {
    expect(() => assertRequiredHeaders([["車番", "運転者名"]], ["車番", "運転者名"], "テスト帳票")).not.toThrow();
  });

  it("「いずれか1つがあればよい」列名グループは、どちらか片方があれば通す", () => {
    expect(() =>
      assertRequiredHeaders([["社員No", "氏名"]], ["社員No", ["氏　名", "氏名"]], "テスト帳票"),
    ).not.toThrow();
  });

  it("単一列名が見つからない場合、その列名を含む例外を投げる", () => {
    expect(() => assertRequiredHeaders([["運転者名"]], ["車番"], "テスト帳票")).toThrow(/車番/);
  });

  it("「いずれか」列名グループがどちらも無ければ、選択肢を「または」で連結した例外を投げる", () => {
    expect(() => assertRequiredHeaders([["社員No"]], [["氏　名", "氏名"]], "テスト帳票")).toThrow(
      "氏　名または氏名",
    );
  });

  it("見出し行そのものが読み取れない(空)場合も、見つからない列名で例外を投げる", () => {
    expect(() => assertRequiredHeaders([], ["車番"], "テスト帳票")).toThrow(/見出しを読み取れませんでした/);
  });
});

describe("toRecords", () => {
  it("データ行が無ければ空配列を返す", () => {
    expect(toRecords([])).toEqual([]);
  });

  it("ヘッダー行と値をペアにしたレコード配列を作る", () => {
    expect(toRecords([["a", "b"], ["1", "2"]])).toEqual([{ a: "1", b: "2" }]);
  });

  it("値が欠けている列は空文字で補う(列数がヘッダーより少ない行)", () => {
    expect(toRecords([["a", "b"], ["1"]])).toEqual([{ a: "1", b: "" }]);
  });
});
