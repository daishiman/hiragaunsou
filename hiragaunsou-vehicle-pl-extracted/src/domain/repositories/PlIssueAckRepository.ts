import type { PlIssueAckKey, PlIssueAckRecord } from "../rules/plIssueAck";

/**
 * 指摘の「確認済み」の印の永続化。
 *
 * 指摘そのものは保存しない (表示のたびに導出する) ため、ここに入るのは
 * 「どの指摘を誰がいつ確認したか」だけになる。
 */
export interface PlIssueAckRepository {
  findByYearMonth(yearMonth: string): Promise<PlIssueAckRecord[]>;
  /** 年月 + 車番 + 列 + 指摘の種類 で upsert する (2回押しても増えない) */
  save(
    yearMonth: string,
    key: PlIssueAckKey,
    note: string | null,
    ackedBy: string | null,
  ): Promise<void>;
  /** 確認済みを取り消して、もう一度確認対象に戻す */
  remove(yearMonth: string, key: PlIssueAckKey): Promise<void>;
}
