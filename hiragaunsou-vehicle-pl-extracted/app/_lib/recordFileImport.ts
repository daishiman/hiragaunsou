import type { Db } from "../../src/infrastructure/db/client";
import { D1FileImportLogRepository } from "../../src/infrastructure/db/D1FileImportLogRepository";

/**
 * マスタ取込の記録を残す(docs/product/file-import-common-spec.md §5)。
 *
 * マスタ取込は「下読み → 確認 → 確定」の二段構えで、確定時に届くのは解析済みの行だけで
 * ファイル本体は届かない。そのため中身の指紋は下読みのときに計算したものを画面経由で受け取る。
 * 指紋が無い(下読みを経ていない)場合は記録しない。名前だけの記録を残すと、
 * 次の取込で「中身が同じ」と誤って判定してしまう。
 *
 * 記録に失敗してもマスタ自体は取り込めているので、呼び出し側の成否には影響させない。
 */
export async function recordFileImport(
  db: Db,
  input: {
    screen: "vehicle_master" | "driver_master";
    fileName: unknown;
    contentHash: unknown;
    rowCount: number;
    session: { id: string; name: string };
  },
): Promise<void> {
  if (typeof input.contentHash !== "string" || input.contentHash === "") return;
  try {
    await new D1FileImportLogRepository(db).record({
      screen: input.screen,
      sourceType: input.screen,
      yearMonth: null,
      fileName: typeof input.fileName === "string" && input.fileName !== "" ? input.fileName : "(名前不明)",
      contentHash: input.contentHash,
      rowCount: input.rowCount,
      importedBy: input.session.id,
      importedByName: input.session.name,
    });
  } catch (e) {
    console.error("file import log failed", { screen: input.screen, error: e });
  }
}
