/**
 * Cloudflare D1 の固定制約と、それを守るための分割ユーティリティ。
 *
 * D1 は 1 クエリあたりのバインドパラメータを 100 個までしか受け付けない。
 * ローカル開発の miniflare は素の SQLite (上限 999) なのでこの制限を再現せず、
 * 「ローカルとテストは通るのに本番の取込だけ失敗する」という形で表面化する。
 * そのため上限は定数として明示し、一括 INSERT は必ず chunkForD1() を通す。
 */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * 1 行あたり columnsPerRow 個のパラメータを使う一括 INSERT を、
 * D1 の上限に収まる行数ごとに分割する。
 */
export function chunkForD1<T>(rows: readonly T[], columnsPerRow: number): T[][] {
  if (columnsPerRow > D1_MAX_BOUND_PARAMS) {
    throw new Error(
      `1行あたり${columnsPerRow}個のバインドパラメータはD1の上限(${D1_MAX_BOUND_PARAMS})を超えます。列を減らすかSQLを見直してください。`,
    );
  }
  const size = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / columnsPerRow));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}
