import { getScreen } from "../../../app/_lib/screens";

/**
 * 画面の呼び名を、テストの中に書き写さない。
 *
 * 見出しの文字列を spec に直書きすると、app/_lib/screens.ts で画面名を変えた瞬間に
 * E2E が落ちる。実際に落ちた: 「収支表のチェック」を「チェック(いつもと違う値を
 * 1件ずつ判定)」に改めたとき、画面は正しく動いているのに monthly-close-chain が赤くなった。
 *
 * 呼び名の正は screens.ts の1行しかない。テストもそこから引く。
 * こうしておくと、見出しの言い回しを変えただけでは落ちず、
 * 「その画面が出ない」ときにだけ落ちる。
 */
export function screenHeading(href: string): RegExp {
  const def = getScreen(href);
  if (!def) throw new Error(`app/_lib/screens.ts に ${href} の定義がありません`);
  /*
    見出しはページ側で対象月や件数を足して上書きすることがある (ScreenHeader の title)。
    その差で落とさないため、括弧より前 = 画面の呼び名だけで見る。
    「チェック(いつもと違う値を1件ずつ判定)」→「チェック」
  */
  const head = def.title.split(/[（(]/)[0]!.trim();
  return new RegExp(escapeRegExp(head));
}

/** サイドバー・メニューでの呼び名 (見出しとは別に短くしてある画面がある)。 */
export function screenLabel(href: string): string {
  const def = getScreen(href);
  if (!def) throw new Error(`app/_lib/screens.ts に ${href} の定義がありません`);
  return def.label;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
