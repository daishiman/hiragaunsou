import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ボタンの見せ方を「1箇所で決まる」状態に固定するテスト。
 *
 * 依頼者の指摘 (2026-08-09):
 *   「視覚的にわかるように文字とボタンを配置していますが、これだと分かりにくかったり、
 *    逆に鬱陶しいところがあるので、この辺はアイコンで表示するなどの工夫をしてください。」
 *   「毎回それを一つ一つ改善するってなると手間なので共通化しておいてください。」
 *
 * 画面ごとに px と色を手書きすると、同じ「削除」でも高さも丸みも違ってしまう。
 * 見た目は app/globals.css の .btn 系だけが持つ。判断基準は docs/design-system.md §11-12。
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

/** その行の className が、直前8行以内で開かれた <button> のものか */
function belongsToButton(lines: string[], index: number): boolean {
  for (let i = index; i >= Math.max(0, index - 8); i--) {
    if (/<button\b/.test(lines[i])) return true;
    if (/<(Link|a|summary|div|span|p|section|input|select|label)\b/.test(lines[i])) return false;
  }
  return false;
}

describe("ボタンの見せ方は共通クラスで決まる", () => {
  it("押しても画面が変わらないものを、リンクの見た目(下線)にしない", () => {
    /*
      下線のついた文字は「押すと別の画面に行く」の意味で全画面そろえている。
      その場で処理が走るだけのものに下線を使うと、戻れると思って押した人が迷う。
    */
    const offenders: string[] = [];
    for (const file of tsxFilesUnder(APP_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        if (!/className=.*\bunderline\b/.test(line)) continue;
        if (belongsToButton(lines, i)) offenders.push(`${file.slice(APP_DIR.length + 1)}:${i + 1}`);
      }
    }
    expect(offenders, "button には .btn btn-quiet btn-sm を使う").toEqual([]);
  });

  it("消す・止める操作の見た目を画面ごとに手書きしない", () => {
    /*
      取り返しのつかない操作は .btn-danger 1箇所で決める。
      caution 色を直接書いた行があると、画面ごとに枠と余白が割れる。
    */
    const handwritten = /className="[^"]*bg-caution-soft[^"]*"/;
    const offenders: string[] = [];
    for (const file of tsxFilesUnder(APP_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        if (!handwritten.test(line)) continue;
        if (belongsToButton(lines, i)) offenders.push(`${file.slice(APP_DIR.length + 1)}:${i + 1}`);
      }
    }
    expect(offenders, "危険な操作は .btn .btn-danger を使う").toEqual([]);
  });

  it("ボタンの名前を名詞1語で終わらせない", () => {
    /*
      依頼者の指摘: 「「メニュー」っていうボタンがありますが、これって何のメニューボタンですか?」
      名詞だけのラベルは「何が起きるか」を言っていない。動詞で終える。
    */
    const banned = ["削除", "取消", "メニュー", "編集", "更新", "確定", "設定", "追加"];
    const offenders: string[] = [];
    for (const file of tsxFilesUnder(APP_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [i, line] of lines.entries()) {
        const label = line.trim();
        if (!banned.includes(label)) continue;
        if (belongsToButton(lines, i)) offenders.push(`${file.slice(APP_DIR.length + 1)}:${i + 1}`);
      }
    }
    expect(offenders, "「このユーザーを削除する」のように動詞で終える").toEqual([]);
  });
});
