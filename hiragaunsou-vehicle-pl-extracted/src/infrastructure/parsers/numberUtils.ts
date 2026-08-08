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

/**
 * 収支表の「車番」セルは、トラクタとトレーラを1セルにまとめた複合表記になっていることがある
 * (実データの「129　　1113」「385/100」)。マスタは1台1行なので、この表記をそのまま車番として
 * 扱うと "1291113" のような実在しない車両が1台できてしまう。
 * 区切り文字で分けた各要素を返す (単独表記なら1要素)。
 */
export function splitCompositeVehicleNo(value: string | null | undefined): string[] {
  if (value == null) return [];
  return value
    // \s は全角スペース(U+3000)も含む。ソースに生の全角スペースを書くと見分けが付かないため書かない。
    .split(/[\s/／,、･・]+/)
    .map((part) => normalizeKey(part))
    .filter((part) => part !== "");
}

/** 全角数字・空白混在の整数文字列を数値へ (社員No・車両コード等のキー正規化用) */
export function normalizeKey(value: string | null | undefined): string {
  if (value == null) return "";
  return value
    .trim()
    .replace(/[\u3000]/g, "") // 全角スペース除去
    .replace(/^0+(?=\d)/, ""); // 先頭ゼロ除去 ("00001111" -> "1111")
}
