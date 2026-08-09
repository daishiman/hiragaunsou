import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 対象月の既定を1箇所に揃えたことを、構造として固定する。
 *
 * 「取り込んだのに反映されていない」の正体は、画面ごとに既定の対象月がバラバラだったこと
 * (取込は5月、他の画面は当月)。1画面ずつ直しても、次に画面を足すときに同じ穴が開く。
 * そこで「画面ファイルの中で当月を既定として使わない」というルール自体をテストで守る。
 *
 * 例外を認める場合は EXCEPTIONS に理由を書いて足すこと。
 */
const APP_DIR = join(__dirname, "../../app/(app)");

/** 当月を返す関数。画面の既定値としては使わない (作業中の月とずれるため)。 */
const FORBIDDEN = ["currentYearMonth(", "defaultImportYearMonth("];

/** 例外を認めるときは、ファイルの相対パスと理由をここに書く。現時点では例外なし。 */
const EXCEPTIONS: Record<string, string> = {};

function collectFiles(dir: string, base = ""): { rel: string; abs: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(abs).isDirectory()) return collectFiles(abs, rel);
    return rel.endsWith(".tsx") ? [{ rel, abs }] : [];
  });
}

describe("画面の対象月の既定", () => {
  it("画面ファイルは当月を既定の対象月に使わない", () => {
    const offenders = collectFiles(APP_DIR)
      .filter(({ rel }) => !(rel in EXCEPTIONS))
      .filter(({ abs }) => {
        const source = readFileSync(abs, "utf8");
        return FORBIDDEN.some((token) => source.includes(token));
      })
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });
});
