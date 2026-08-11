import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { factorCategoryLabel } from "../../app/_lib/factorLabels";
import {
  importBatchStatusLabel,
  sourceTypeLabel,
  usageKindLabel,
} from "../../app/_lib/kindLabels";
import { SCREENS, SCREEN_GROUPS } from "../../app/_lib/screens";
import { severityLabel } from "../../app/_lib/severity";

const REPO_ROOT = join(__dirname, "../..");
const SOURCE_ROOTS = [join(REPO_ROOT, "app"), join(REPO_ROOT, "src")];

const FORBIDDEN_UI_TERMS: readonly [label: string, pattern: RegExp][] = [
  ["km単価", /km単価/],
  ["ユーザー", /ユーザー/],
  ["消す", /(?<!取り)消す/],
  ["修正して残す", /修正して残す/],
  ["そのまま残す", /そのまま残す/],
  ["問題なし", /問題なし/],
  ["確認しました", /確認しました/],
  ["OK", /(?<![A-Z])OK(?![A-Z])/],
  ["対象月", /対象月/],
  ["再計算", /再計算/],
  ["利益", /利益(?!率)/],
  ["判断", /判断/],
  ["ドライバー・乗務員", /ドライバー|乗務員/],
];

function sourceFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...sourceFilesUnder(path));
    else if (/\.(ts|tsx)$/.test(name)) files.push(path);
  }
  return files;
}

/** 実装の説明は検査対象にせず、画面やAPIへ渡り得る文字列だけを残す。 */
function sourceWithoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""))
    .replace(/\/\/.*$/gm, "");
}

describe("T7のUI語彙", () => {
  it("既知の内部キーを用途ごとの日本語に訳す", () => {
    expect(usageKindLabel("deficit_factor_analysis")).toBe("赤字の要因分析");
    expect(sourceTypeLabel("vehicle_operation")).toBe("車両別運行実績表");
    expect(importBatchStatusLabel("completed")).toBe("取込済み");
    expect(factorCategoryLabel("fuelTotal")).toBe("燃料費");
    expect(severityLabel("blocking")).toBe("要修正");
  });

  it("未知の内部キーを画面へ漏らさず、日本語の安全な表示に閉じる", () => {
    expect(usageKindLabel("future_usage_kind")).toBe("未対応の利用種別");
    expect(sourceTypeLabel("future_source_type")).toBe("判別できない帳票");
    expect(importBatchStatusLabel("future_status")).toBe("状態を確認できません");
    expect(factorCategoryLabel("future_factor")).toBe("要因を分類できません");
    expect(severityLabel("future_severity")).toBe("重大さを確認できません");
  });

  it("画面名・説明・導線は同じ語彙を使う", () => {
    const values = [
      ...SCREEN_GROUPS.map((group) => group.label),
      ...SCREENS.flatMap((screen) => [
        screen.label,
        screen.title,
        screen.desc,
        screen.lead,
        screen.does,
        screen.notHere?.text,
        screen.notHere?.linkLabel,
        screen.next?.text,
        screen.next?.linkLabel,
      ]).filter((value): value is string => value !== undefined),
    ];

    for (const [term, pattern] of FORBIDDEN_UI_TERMS) {
      expect(values.filter((value) => pattern.test(value)), `旧語「${term}」`).toEqual([]);
    }
  });

  it("新しい画面や表示用データにも旧語を戻さない", () => {
    const offenders: string[] = [];
    for (const root of SOURCE_ROOTS) {
      for (const file of sourceFilesUnder(root)) {
        const lines = sourceWithoutComments(readFileSync(file, "utf8")).split("\n");
        for (const [index, line] of lines.entries()) {
          for (const [term, pattern] of FORBIDDEN_UI_TERMS) {
            if (pattern.test(line)) {
              offenders.push(`${relative(REPO_ROOT, file)}:${index + 1} 旧語「${term}」`);
            }
          }
        }
      }
    }

    expect(
      offenders,
      "収支表の元帳票列名「利益率」は例外。それ以外は docs/product/T7-ui-conventions.md §1 の語彙を使う",
    ).toEqual([]);
  });
});
