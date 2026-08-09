import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../src/infrastructure/auth/session";
import { checkAccess } from "../../src/infrastructure/auth/accessControl";
import { createDb } from "../../src/infrastructure/db/client";
import { importDiffDetector } from "../_lib/masterChangeStack";
import { ImportDiffAlertList } from "./ImportDiffAlertList";
import type { ImportDiff } from "../../src/domain/rules/importDiffDetection";

/**
 * 「前回と異なります」を出す独立した部品。
 *
 * どの画面にも1行 (`<ImportDiffAlertPanel />`) で置ける形にしてある。
 * 置く側の画面のコードを書き換えずに済むよう、権限の確認とデータ取得までここで完結させる。
 * 違いが1件も無いとき・権限が無いときは何も描かない。空の枠が常駐すると、そこは見なくなる。
 *
 * 見せ方の決まり:
 *   - 強く確認したいもの (桁違い・未割当・消えた行・文字化け・二重登録) だけを開いて出す
 *   - ふつうの変更 (人事異動・金額改定) は畳んでおく。全部を同じ強さで出すと読まれない
 *   - 書き方が違うだけのもの (全角/半角・空白・ゼロ埋め) はそもそも出さない
 */
export async function ImportDiffAlertPanel({ className }: { className?: string }) {
  const session = await getServerSession();
  if (!checkAccess(session, "input")) return null;

  const diffs = await loadDiffs();
  if (diffs.length === 0) return null;
  return <ImportDiffAlertList diffs={diffs} className={className} />;
}

/** 付帯情報なので、読めなくても置いた画面の本体の作業は止めない (何も出さないだけ) */
async function loadDiffs(): Promise<ImportDiff[]> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const alert = await importDiffDetector(createDb(env.DB)).execute({ persist: false });
    return alert.diffs;
  } catch {
    return [];
  }
}
