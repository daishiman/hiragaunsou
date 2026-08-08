import { and, desc, eq, or } from "drizzle-orm";
import type { Db } from "./client";
import { fileImportLog } from "./schema";
import type { DuplicateFinding } from "../../domain/rules/fileImportCheck";

export interface FileImportLogEntry {
  id: string;
  screen: string;
  sourceType: string;
  yearMonth: string | null;
  fileName: string;
  contentHash: string;
  rowCount: number;
  importedAt: number;
  importedByName: string;
}

/**
 * ファイル取込の記録の読み書き。取込前の重複照合と、取込データ管理画面の履歴表示に使う。
 * 仕様は docs/product/file-import-common-spec.md §5。
 */
export class D1FileImportLogRepository {
  constructor(private readonly db: Db) {}

  async record(input: {
    screen: string;
    sourceType: string;
    yearMonth: string | null;
    fileName: string;
    contentHash: string;
    rowCount: number;
    importedBy: string | null;
    importedByName: string;
  }): Promise<void> {
    await this.db.insert(fileImportLog).values({ id: crypto.randomUUID(), ...input });
  }

  /**
   * 「中身が同じ」または「名前が同じ」記録を新しい順に取り、2軸で照合する。
   *
   * 中身が同じものを優先するのは、名前だけの一致は同一ファイルの根拠にならないため
   * (毎月同じ名前で中身が入れ替わるのが社内の実態)。
   *
   * 照合は同じ画面の記録だけを見る。社内Excel「★車両別収支計算用」は車両マスタと
   * 運転者マスタの両方で正しく使うファイルで、画面をまたいで照合すると
   * 「取り込み済みです」と誤って止めてしまう。
   */
  async findDuplicate(input: {
    screen: string;
    contentHash: string;
    fileName: string;
  }): Promise<DuplicateFinding | null> {
    const rows = await this.db
      .select()
      .from(fileImportLog)
      .where(
        and(
          eq(fileImportLog.screen, input.screen),
          or(eq(fileImportLog.contentHash, input.contentHash), eq(fileImportLog.fileName, input.fileName)),
        ),
      )
      .orderBy(desc(fileImportLog.importedAt))
      .limit(20);
    if (rows.length === 0) return null;

    const sameContent = rows.filter((r) => r.contentHash === input.contentHash);
    const sameContentSameName = sameContent.find((r) => r.fileName === input.fileName);
    if (sameContentSameName) return toFinding("sameContentSameName", sameContentSameName);
    if (sameContent[0]) return toFinding("sameContentOtherName", sameContent[0]);

    const sameName = rows.find((r) => r.fileName === input.fileName);
    if (sameName) return toFinding("sameNameChangedContent", sameName);
    return null;
  }

  /** 取込データ管理画面向け: 全画面の取込記録を新しい順に返す。 */
  async listAll(limit = 200): Promise<FileImportLogEntry[]> {
    const rows = await this.db
      .select()
      .from(fileImportLog)
      .orderBy(desc(fileImportLog.importedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      screen: r.screen,
      sourceType: r.sourceType,
      yearMonth: r.yearMonth,
      fileName: r.fileName,
      contentHash: r.contentHash,
      rowCount: r.rowCount,
      importedAt: r.importedAt.getTime(),
      importedByName: r.importedByName,
    }));
  }

  /**
   * 取り込んだデータ本体を消したとき、対応する記録も消す。
   * 記録だけ残ると「取り込み済みです」と出るのに実際のデータは無い、という食い違いが起きる。
   */
  async deleteMatching(input: {
    sourceType: string;
    yearMonth: string;
    fileName: string;
  }): Promise<void> {
    await this.db
      .delete(fileImportLog)
      .where(
        and(
          eq(fileImportLog.sourceType, input.sourceType),
          eq(fileImportLog.yearMonth, input.yearMonth),
          eq(fileImportLog.fileName, input.fileName),
        ),
      );
  }

  /** 取込データ管理画面から記録を1件だけ取り消すとき。 */
  async deleteByIds(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.db.delete(fileImportLog).where(eq(fileImportLog.id, id));
    }
  }
}

function toFinding(
  match: DuplicateFinding["match"],
  row: { fileName: string; importedAt: Date; rowCount: number; yearMonth: string | null },
): DuplicateFinding {
  return {
    match,
    fileName: row.fileName,
    importedAt: row.importedAt.getTime(),
    rowCount: row.rowCount,
    yearMonth: row.yearMonth,
  };
}
