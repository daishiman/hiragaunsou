import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Claude Code から呼ぶ導線の定義に、鍵を読む手順が入っていないことを確かめる。
 *
 * 定義に「1Password から鍵を取り出して」「.env を読んで」と1行でも書いてしまうと、
 * Claude はその通りに鍵を読み、読んだものが会話の履歴に残る。
 * 鍵の解決はスクリプトの中だけで完結させ、定義には一切書かない。
 *
 * 人が後から親切のつもりで手順を足すことは十分あるので、注意書きではなく
 * 通れない道にしておく。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 導線の定義はリポジトリ直下の .claude にある (アプリのフォルダの1つ上)。 */
const COMMANDS_DIR = path.resolve(HERE, "../../../.claude/commands");

/** 今回足した導線。キット由来の定義 (build-app など) はここでは見ない。 */
const OURS = ["improvements.md", "improvement-fix.md", "improvements-fix-all.md"];

/**
 * 鍵を読ませる書き方。
 * 「鍵」という言葉自体は禁じない (使ってはいけないことを説明する必要があるため)。
 * 禁じるのは、鍵の値を取り出す具体的な手立て。
 */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bop\s+(read|item\s+get)\b/, why: "1Password から鍵を読み出す手順" },
  { pattern: /HGCC_TOKEN\s*=/, why: "鍵を環境変数へ書く手順" },
  { pattern: /\.env(\.|\b)/, why: "設定ファイルを読ませる手順" },
  { pattern: /Authorization:\s*Bearer/i, why: "鍵をヘッダに書く手順" },
  { pattern: /\bcurl\b/, why: "鍵を自分で付けて叩く手順" },
  { pattern: /hgcc_[A-Za-z0-9_-]{20,}/, why: "鍵の実物" },
];

describe("Claude Code の導線には、鍵を読む手順を書かない", () => {
  const files = readdirSync(COMMANDS_DIR);

  it("今回の導線がすべて置かれている", () => {
    for (const name of OURS) expect(files).toContain(name);
  });

  for (const name of OURS) {
    it(`${name} に鍵を扱う手順が無い`, () => {
      const text = readFileSync(path.join(COMMANDS_DIR, name), "utf8");
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(text), `${name} に「${why}」が書かれています`).toBe(false);
      }
    });

    it(`${name} が鍵を扱わないことを明記している`, () => {
      const text = readFileSync(path.join(COMMANDS_DIR, name), "utf8");
      // 「書いていない」だけでなく「触らない」と言い切ってあること。
      // 空白の指示は、後から手順を足す人を止められない。
      expect(text).toContain("鍵 (トークン) を自分で読まない");
    });
  }
});
