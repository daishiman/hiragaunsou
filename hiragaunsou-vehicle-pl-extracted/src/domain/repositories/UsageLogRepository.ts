/**
 * AI呼び出し等、従量課金が発生する外部サービス利用のログ記録インターフェース。
 * /usage 画面(月次概算費用・利用者別内訳)の唯一のデータソースになる。
 */
export interface UsageLogEntry {
  kind: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  recordedBy: string | null;
  detail: unknown;
}

export interface UsageLogRecord extends UsageLogEntry {
  id: string;
  createdAt: number;
}

export interface UsageLogRepository {
  record(entry: UsageLogEntry): Promise<void>;

  /** /usage 画面用: 指定エポックms以降に記録された利用ログを新しい順で返す */
  findSince(sinceMs: number): Promise<UsageLogRecord[]>;
}
