/**
 * カンマ区切り金額文字列 (例 "663,820", "  99,573") を数値に変換する。
 * 給与集計表(ACELINK NX-CE)は金額を右詰め+カンマ区切りの文字列で出力するため必須の変換。
 */
export function parseJapaneseAmount(value: string | null | undefined): number {
  if (value == null) return 0;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "-") return 0;
  const cleaned = trimmed.replace(/,/g, "").replace(/[¥￥\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** 全角数字・空白混在の整数文字列を数値へ (社員No・車両コード等のキー正規化用) */
export function normalizeKey(value: string | null | undefined): string {
  if (value == null) return "";
  return value
    .trim()
    .replace(/[\u3000]/g, "") // 全角スペース除去
    .replace(/^0+(?=\d)/, ""); // 先頭ゼロ除去 ("00001111" -> "1111")
}
