import { findScreen } from "./screens";

/**
 * 「いま開いている URL」から、改善要望を束ねる単位を決める。
 *
 * 実URL (/vehicle/1177?ym=2026-05) をそのまま数えると、同じ画面への同じ指摘が
 * 車番の数だけ別件に分かれ、「どの画面が一番困られているか」が読めなくなる。
 * そこで保存するのは次の3つ。
 *   path         — クエリと # を落とした実URL。「その時どこを見ていたか」の手がかり
 *   routePattern — 集計の単位 (/vehicle/[vehicleNo])。一覧の絞り込みと件数はこれで数える
 *   label        — 画面台帳 (screens.catalog.ts) にある呼び名。サイドバーと同じ言葉で見せる
 *
 * クエリを落とすのは集計のためだけではない。対象月や検索語がそのまま要望に
 * 貼り付くと、送った本人が意図していない情報まで管理者の一覧に並ぶ。
 */

/**
 * 動的ルートの一覧。Next.js の app/ 配下で [ ] を含むフォルダと1対1で対応させる。
 * 画面を1枚足したときは、動的ルートならここに1行足す
 * (足し忘れても実URLのまま保存されるだけで、要望が消えることはない)。
 */
const DYNAMIC_ROUTES: readonly { readonly match: RegExp; readonly pattern: string }[] = [
  { match: /^\/vehicle\/[^/]+$/, pattern: "/vehicle/[vehicleNo]" },
  { match: /^\/admin\/improvements\/[^/]+$/, pattern: "/admin/improvements/[id]" },
] as const;

export interface RouteIdentity {
  path: string;
  routePattern: string;
  label: string;
}

/** 画面台帳に無いパスの呼び名。空欄にすると一覧に名前の無い行ができる。 */
export const UNKNOWN_SCREEN_LABEL = "その他の画面";

/**
 * 実URL → 保存する3つの値。
 *
 * 受け取るのはブラウザが送ってくる文字列なので、想定外の形 (空文字・//で始まる・
 * 極端に長い) でも落ちずに何かを返す。呼び出し側 (API) は別途、形の検査を行う。
 */
export function routeIdentityOf(rawPath: string): RouteIdentity {
  const path = normalizePath(rawPath);
  const routePattern = DYNAMIC_ROUTES.find((r) => r.match.test(path))?.pattern ?? path;
  // 台帳は /vehicle のように前方一致で持っているので、実URLで引く
  // ([vehicleNo] を含む文字列では前方一致に当たらない)。
  const label = findScreen(path)?.label ?? UNKNOWN_SCREEN_LABEL;
  return { path, routePattern, label };
}

/** クエリ・#・末尾のスラッシュを落として、比較できる形にそろえる。 */
function normalizePath(rawPath: string): string {
  const cut = rawPath.split(/[?#]/)[0] ?? "";
  if (!cut.startsWith("/")) return "/";
  // "//example.com" のような別サイトへ読み替えられる形は受け取らない
  if (cut.startsWith("//")) return "/";
  if (cut.length > 1 && cut.endsWith("/")) return cut.slice(0, -1);
  return cut;
}

/** 画面パスとして受け取ってよい形かどうか (API の入口で使う)。 */
export function isAcceptableScreenPath(rawPath: unknown): rawPath is string {
  return (
    typeof rawPath === "string" &&
    rawPath.length > 0 &&
    rawPath.length <= 300 &&
    rawPath.startsWith("/") &&
    !rawPath.startsWith("//")
  );
}
