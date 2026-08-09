import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 「本文はどの画面でも幅いっぱい」を固定するテスト。
 *
 * 依頼者の指摘 (2026-08-09、3度):
 *   「なぜ左側のスペースじゃなくて右側のスペースが空いているのが気になります。全画面共通でお願いします」
 *   「このページも右側に空白が空いています。全てのページ見直して改善を行ってください」(/report)
 *   「これらも」(/profile・/ai-settings)
 *   「今後、同様に新しく画面追加した場合でも、これを対応できるようにしておいてほしいです」
 *
 * 経緯が大事なので残す。最初は各ページが独自に max-w-3xl / max-w-5xl を書いていた。
 * それを screens.ts の width 宣言(wide / narrow)に集約したが、narrow にした5画面が
 * 今度は「右半分が丸ごと空く」状態になり、依頼者から不具合として指摘された。
 *
 * カード・フォーム・見出しは横に伸びても読みにくくならない。読み幅の制限が意味を持つのは
 * 「途切れない長文の段落」だけで、それは .prose-note が段落ブロック単位で持つ。
 * ページ全体には掛けない。→ 幅の分岐そのものを無くした。
 *
 * このテストは**画面が増えても効く**ように書いてある。特定の画面名を並べず、
 * app/(app) 配下を丸ごと走査するので、新しい画面で max-w-* を書いた時点で落ちる。
 */

const APP_DIR = join(__dirname, "../../app/(app)");
const APP_SHELL = join(__dirname, "../../app/_components/AppShell.tsx");
const SCREENS = join(__dirname, "../../app/_lib/screens.ts");

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsxFilesUnder(path));
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("本文の幅は全画面で同じ", () => {
  it("ページ側に画面全体を包む max-w-* を書かない", () => {
    /*
      許すのは「部品の中の1要素」に効く max-w だけ (入力欄1つの上限、札の文字数上限など)。
      画面全体を包む用途の max-w-2xl 〜 max-w-7xl を禁止する。
      新しい画面を足した人がここを踏むと、この行にファイル名と行番号が出る。
    */
    const banned = /className="[^"]*\bmax-w-(2xl|3xl|4xl|5xl|6xl|7xl)\b/;
    const offenders: string[] = [];

    for (const file of tsxFilesUnder(APP_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        if (banned.test(line)) offenders.push(`${file.slice(APP_DIR.length + 1)}:${i + 1}`);
      }
    }

    expect(
      offenders,
      "本文は全画面で幅いっぱい。長文だけ狭めたいなら Prose (.prose-note) を使う",
    ).toEqual([]);
  });

  it("本文を包む <main> に幅の上限を書かない", () => {
    // 画面ごとの分岐を戻そうとすると、まずここに max-w か mx-auto が生える。
    const main = readFileSync(APP_SHELL, "utf8")
      .split("\n")
      .find((line) => line.includes("<main"));

    expect(main, "AppShell に <main> が見つからない").toBeDefined();
    expect(main).not.toMatch(/\bmax-w-/);
    expect(main).not.toMatch(/\bmx-auto\b/);
  });

  it("画面定義に幅の指定を持たせない", () => {
    // width / narrow を screens.ts に足すと、また画面ごとに幅が割れる。
    const source = readFileSync(SCREENS, "utf8");

    expect(source).not.toMatch(/\bScreenWidth\b/);
    expect(source, "幅は画面ごとに宣言しない。全画面で同じ").not.toMatch(/\bwidth\??:/);
  });
});
