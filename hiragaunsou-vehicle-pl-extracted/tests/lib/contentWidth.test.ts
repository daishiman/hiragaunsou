import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentWidthClass } from "../../app/_lib/navigation";

/**
 * 本文の幅を「1箇所で決まる」状態に固定するテスト。
 *
 * 依頼者の指摘 (2026-08-09):
 *   「なぜこのように左側のスペースじゃなくて右側のスペースが空いているのが気になります。
 *    …このデータ取込に関しては、右と左で切り分けるような空白が右側に存在したりします。
 *    全画面共通でお願いします。」
 *
 * 原因は各ページが独自に max-w-3xl / max-w-5xl を書いていたこと。
 * 幅は app/_lib/screens.ts の width 宣言 → AppShell の <main> だけで決める。
 * 新しい画面を足した人が、つい各ページに max-w-* を書き足すのをここで止める。
 */

const APP_DIR = join(__dirname, "../../app/(app)");

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsxFilesUnder(path));
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("本文の幅は1箇所で決まる", () => {
  it("ページ側に画面全体を包む max-w-* を書かない", () => {
    /*
      許すのは「部品の中の1要素」に効く max-w だけ (入力欄1つの上限、札の文字数上限など)。
      画面全体を包む用途の max-w-2xl 〜 max-w-7xl と、中央寄せの mx-auto を禁止する。
    */
    const banned = /className="[^"]*\bmax-w-(2xl|3xl|4xl|5xl|6xl|7xl)\b/;
    const offenders: string[] = [];

    for (const file of tsxFilesUnder(APP_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        if (banned.test(line)) offenders.push(`${file.slice(APP_DIR.length + 1)}:${i + 1}`);
      }
    }

    expect(offenders, "幅は app/_lib/screens.ts の width で宣言する").toEqual([]);
  });

  it("定義のあるパスは宣言どおりの幅になる", () => {
    // 表・一覧・工程の画面は幅いっぱい。右側に説明のつかない余白を作らない。
    expect(contentWidthClass("/import")).toBe("");
    expect(contentWidthClass("/grid")).toBe("");
    expect(contentWidthClass("/manual-entry")).toBe("");
    expect(contentWidthClass("/admin/vehicle-master")).toBe("");
    // 読むだけの画面と1列のフォームだけ、読みやすい幅で止める。
    expect(contentWidthClass("/logic")).toBe("max-w-3xl");
    expect(contentWidthClass("/profile")).toBe("max-w-3xl");
    expect(contentWidthClass("/grid/report")).toBe("max-w-3xl");
  });

  it("定義の無いパスは既定(幅いっぱい)にする", () => {
    expect(contentWidthClass("/存在しない画面")).toBe("");
  });
});
