import { describe, expect, it } from "vitest";
import {
  fieldKindOf,
  fieldUnitOf,
  formatFieldValue,
  isFieldChanged,
  isUnreadableNumber,
  normalizeFieldValue,
  toSubmitValue,
  type EditableFieldDef,
} from "../../app/_components/editForm/fieldDefs";

/**
 * 「変更した箇所を色で出す」「未保存◯件」の土台になる判定。
 *
 * ここが緩いと、直していない欄が「変更」と出て未保存件数が嘘になる。
 * 逆に厳しすぎると、直したのに変更として数えられず黙って保存されない。
 * 画面ごとに書き直さないための共通ルールなので、ここで固定する。
 */
describe("値の揃え方 (normalizeFieldValue)", () => {
  it("数の欄は書き方の違いを同じ値として扱う", () => {
    expect(normalizeFieldValue("yen", "1,200")).toBe("1200");
    expect(normalizeFieldValue("yen", " 1200 ")).toBe("1200");
    expect(normalizeFieldValue("number", "１２００")).toBe("1200");
  });

  it("文字の欄は前後の空白だけを落とす", () => {
    expect(normalizeFieldValue("text", " 大型ウイング ")).toBe("大型ウイング");
    expect(normalizeFieldValue("text", "")).toBe("");
  });

  it("数として読めない値は必ず元の値と違う扱いにする", () => {
    expect(normalizeFieldValue("yen", "あとで")).toBe("読めない値:あとで");
  });
});

describe("変更したかどうか (isFieldChanged)", () => {
  it("打ち替えても同じ値なら変更に数えない", () => {
    expect(isFieldChanged("yen", "1200", "1,200")).toBe(false);
    expect(isFieldChanged("text", "本社", " 本社 ")).toBe(false);
  });

  it("触っていない欄 (null) は変更に数えない", () => {
    expect(isFieldChanged("text", "本社", null)).toBe(false);
    expect(isFieldChanged("text", "本社", undefined)).toBe(false);
  });

  it("空にしたときは変更として数える", () => {
    expect(isFieldChanged("text", "本社", "")).toBe(true);
  });

  it("元が未設定の欄に打ったときも変更として数える", () => {
    expect(isFieldChanged("select", null, "300")).toBe(true);
  });
});

describe("保存を止める判定 (isUnreadableNumber)", () => {
  it("数の欄に数字でない文字が入っていたら止める", () => {
    expect(isUnreadableNumber("yen", "あとで")).toBe(true);
    expect(isUnreadableNumber("yen", "1,200")).toBe(false);
  });

  it("文字・選択の欄は止めない", () => {
    expect(isUnreadableNumber("text", "あとで")).toBe(false);
    expect(isUnreadableNumber("select", "あとで")).toBe(false);
  });
});

describe("画面と保存の形 (formatFieldValue / toSubmitValue)", () => {
  it("金額だけ桁区切りで見せる (桁の間違いは区切りが無いと気づけない)", () => {
    expect(formatFieldValue("yen", "1200")).toBe("1,200");
    expect(formatFieldValue("number", "17.48")).toBe("17.48");
  });

  it("保存するときは数字だけの形にそろえる", () => {
    expect(toSubmitValue("yen", "1,200")).toBe("1200");
    expect(toSubmitValue("text", " 本社 ")).toBe("本社");
  });
});

describe("行ごとに変わる種類と単位", () => {
  const def: EditableFieldDef<{ kind: "rate" | "yen" }> = {
    field: "common",
    label: "全期間共通",
    kind: (r) => (r.kind === "yen" ? "yen" : "number"),
    unit: (r) => (r.kind === "yen" ? "円" : "%"),
    read: () => null,
  };

  it("同じ列に % と 円 が混ざっていても、行ごとの種類で判定できる", () => {
    expect(fieldKindOf(def, { kind: "rate" })).toBe("number");
    expect(fieldKindOf(def, { kind: "yen" })).toBe("yen");
    expect(fieldUnitOf(def, { kind: "rate" })).toBe("%");
  });
});
