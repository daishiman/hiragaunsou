/**
 * 数字の入力欄を「間違えにくく」するための整形。
 *
 * 業務で数字を扱う人は全角で打つ・カンマ付きで貼り付ける・「1,050,000円」ごと貼る。
 * それを直させるのではなく、こちらが受けて正規化する (ポステルの法則)。
 * 表示は常に3桁区切りに戻し、桁を目で数えなくても済むようにする。
 *
 * Presentation層。保存前の検査は既存どおりユースケース側でも行う。
 */

/** 全角数字・記号を半角に落とす */
function toHalfWidth(raw: string): string {
  return raw.replace(/[０-９．，－]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/**
 * 入力文字列を数値にする。数値として読めなければ null。
 * カンマ・空白・単位(円/km/時間/回/枚/人)が混ざっていても受ける。
 */
export function parseNumberInput(raw: string): number | null {
  const cleaned = toHalfWidth(raw)
    .replace(/[,\s]/g, "")
    .replace(/(円|km|Km|KM|時間|h|回|枚|人|L|l)$/u, "");
  if (cleaned === "" || cleaned === "-") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * 入力中の文字列を3桁区切りに整える。
 *
 * 打っている途中の「1050000.」「1050000.0」を壊さないため、小数点以下は
 * 打たれたままの文字列を残し、整数部だけに区切りを入れる。
 */
export function formatNumberInput(raw: string): string {
  const cleaned = toHalfWidth(raw).replace(/[,\s]/g, "");
  if (cleaned === "") return "";
  const negative = cleaned.startsWith("-");
  const body = negative ? cleaned.slice(1) : cleaned;
  if (!/^\d*\.?\d*$/.test(body)) return raw;
  const [intPart = "", decimalPart] = body.split(".");
  const grouped = intPart === "" ? "" : Number(intPart).toLocaleString("en-US");
  const joined = decimalPart === undefined ? grouped : `${grouped}.${decimalPart}`;
  return negative ? `-${joined}` : joined;
}

/** 表示用 (確定した数値を入力欄に戻すとき) */
export function toInputText(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}
