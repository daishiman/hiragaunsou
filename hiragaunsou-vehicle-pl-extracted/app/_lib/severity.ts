import type { ReviewSeverity } from "../../src/domain/rules/vehiclePlReview";

/**
 * 重大さの日本語ラベル。
 *
 * かつては月次収支表・確認ウィザード・確認結果・やることの4画面がそれぞれ同じ表を持っていた。
 * 同じものが4箇所にあると、片方だけ直って「同じ値なのに画面ごとに呼び名が違う」が起きる。
 * 訳の表は1つだけ持つ (docs/product/T7-ui-conventions.md §1-3)。
 */
export const SEVERITY_LABELS: Record<ReviewSeverity, string> = {
  blocking: "要修正",
  warning: "要確認",
  info: "参考",
};

/**
 * 重大さ → 札の見え方。
 *
 * 色相は増やさない (design-system §2)。「要修正」だけを danger で立たせ、
 * 「要確認」は注意の面、「参考」は無彩の面にする。3つとも同じ色で塗ると
 * 重大なものと参考が見分けられなくなる (以前の実装がそうなっていた)。
 */
export const SEVERITY_TONE: Record<ReviewSeverity, "danger" | "caution" | "neutral"> = {
  blocking: "danger",
  warning: "caution",
  info: "neutral",
};

/** 文字列で来た重大さを日本語にする。知らない値も内部キーは画面に出さない。 */
export function severityLabel(severity: string): string {
  return SEVERITY_LABELS[severity as ReviewSeverity] ?? "重大さを確認できません";
}
