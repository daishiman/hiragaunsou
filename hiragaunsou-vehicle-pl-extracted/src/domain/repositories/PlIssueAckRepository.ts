import type { PlIssueAckKey, PlIssueAckRecord, PlIssueAckStatus } from "../rules/plIssueAck";

/** 保存する判断の中身 (キー以外) */
export interface PlIssueAckInput {
  status: PlIssueAckStatus;
  note: string | null;
  /** 判断したときの値。翌月に引き継ぐかどうかの判定に使う */
  valueAtAck: number | null;
  ackedBy: string | null;
}

/**
 * 指摘に対する人の判断 (問題なし / あとで見る) の永続化。
 *
 * 指摘そのものは保存しない (表示のたびに導出する) ため、ここに入るのは
 * 「どの指摘を誰がいつどう判断したか」だけになる。
 */
export interface PlIssueAckRepository {
  findByYearMonth(yearMonth: string): Promise<PlIssueAckRecord[]>;
  /** 年月 + 車番 + 列 + 指摘の種類 で upsert する (2回押しても増えない) */
  save(yearMonth: string, key: PlIssueAckKey, input: PlIssueAckInput): Promise<void>;
  /**
   * まとめて判断を付ける。1件ずつ save を呼ぶと件数分だけ往復が発生するため、
   * 「参考レベルをまとめて問題なしにする」のような操作はこちらを使う。
   */
  saveMany(
    yearMonth: string,
    entries: readonly { key: PlIssueAckKey; input: PlIssueAckInput }[],
  ): Promise<void>;
  /** 判断を取り消して、もう一度確認対象に戻す */
  remove(yearMonth: string, key: PlIssueAckKey): Promise<void>;
  /** まとめて付けた判断をまとめて取り消す (直後の「元に戻す」に使う) */
  removeMany(yearMonth: string, keys: readonly PlIssueAckKey[]): Promise<void>;
}
