import { isYearMonth } from "./yearMonth";

/**
 * ym クエリを受け取って対象月を切り替えるページ。
 * これ以外の画面 (ホーム・ダッシュボード・管理系・マイページ等) は ym を読まないため、
 * リンクに付けても無視されるだけでURLが汚れる。付ける先をここで限定する。
 */
const YM_AWARE_PATHS = [
  "/import",
  "/cleansing",
  "/manual-entry",
  "/anomaly",
  "/grid",
  "/annual",
  "/deficit",
  "/todo",
  "/vehicle",
] as const;

/** href (クエリ付きも可) が ym を受け取るページかどうか */
export function isYmAwareHref(href: string): boolean {
  const path = href.split("?")[0]!.split("#")[0]!;
  return YM_AWARE_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * 画面遷移のリンクに、いま見ている対象年月を引き継がせる。
 *
 * 「/import で2026年5月を選んで取り込んだのに、/cleansing へ移ると別の月が出る」という
 * 事故が起きていた。原因は各ページの既定月 (取込は前月・整形以降は当月) がバラバラなまま、
 * リンクが ym を持たずに静的な href だけで遷移していたこと。対象月はURLに持たせる方針
 * (Cookieやlocalstorageに隠さない) なので、リンク生成時に引き回す。
 *
 * ym が無い/不正、または遷移先が ym を読まないページなら href をそのまま返す。
 * href に既に ym があればそちらを優先する (リンク側の明示指定を上書きしない)。
 */
export function withYm(href: string, ym: string | null | undefined): string {
  if (!ym || !isYearMonth(ym) || !isYmAwareHref(href)) return href;
  if (/[?&]ym=/.test(href)) return href;
  return `${href}${href.includes("?") ? "&" : "?"}ym=${ym}`;
}
