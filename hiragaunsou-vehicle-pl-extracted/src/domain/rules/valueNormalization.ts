/**
 * 突き合わせ専用の「正規化キー」を作る。
 *
 * なぜ要るか:
 *   同じ車・同じ人・同じ金額なのに、出どころのシステムごとに書き方が違う。
 *   実データで確認できているだけでも
 *     車番   : 運行実績は "00001111"、車両マスタは "2222"(ゼロ埋め無し)、売上は "303       "(空白詰め)
 *     社員No : 給与集計表は "0093" (4桁ゼロ埋め)
 *     氏名   : 姓名の間の空白の有無、全角空白、康熙部首まじりの漢字 (docs/product/master-data-spec.md)
 *   これを別物として扱うと、同じ運転者がマスタに2件でき、片方だけ直して片方が古いまま残る。
 *
 * 大原則:
 *   **正規化するのは突き合わせのときだけ。画面に出す文字列は元のまま触らない。**
 *   人が入れた表記を勝手に書き換えると、元の請求書・元のCSVと見比べられなくなる。
 *
 * 線引き:
 *   - 書き方が違うだけで意味が変わらないもの(全角/半角・空白・ゼロ埋め)は自動で同じとみなす
 *   - 1文字でも意味が変わりうるもの(「田中」と「田仲」)は自動で同じにしない。人に確認を出す
 *
 * Domain層: フレームワーク非依存。D1・fetch等の外部依存を import しない。
 */

/**
 * すべての正規化の土台。
 *
 * NFKC は「全角英数→半角」「半角カナ→全角カナ」「康熙部首→通常の漢字」をまとめて片付ける。
 * 実データの氏名に康熙部首まじりの表記が実在するため、ここは NFKC でなければ足りない。
 */
function toNfkc(value: string): string {
  return value.normalize("NFKC");
}

/** ハイフンに見える文字の全部。全角ハイフン・長音・ダッシュ類・マイナス記号 */
const HYPHEN_LIKE = /[‐-―−－ー⁃˗]/g;

/**
 * 一般の文字列の突き合わせキー。
 *
 * 空白は「除去」する。氏名の姓名間スペースの有無を無視するのが目的で、
 * 1個に詰めるだけでは "田中 一郎" と "田中一郎" が別物のまま残る。
 */
export function normalizeCompareKey(value: string | null | undefined): string {
  if (value == null) return "";
  return toNfkc(value)
    .replace(HYPHEN_LIKE, "-")
    .replace(/[\s\u3000]/g, "")
    .toLowerCase();
}

/**
 * 車番・社員コードなどの識別子の突き合わせキー。
 *
 * 先頭ゼロを落とす。既存の取込処理 (parsers/numberUtils.ts の normalizeKey) が
 * すでに同じ扱いをしていて、それで現行Excelとの突合が成立している。
 * つまり「ゼロ埋めの有無は業務上の意味を持たない」ことは実データで確認済み。
 * ここではそれに NFKC を足して、全角数字の "１１１１" も同じ土俵に乗せる。
 *
 * 数字以外を含むコードの先頭ゼロは落とさない (落とすと別のコード体系を壊しうる)。
 */
export function normalizeIdKey(value: string | null | undefined): string {
  if (value == null) return "";
  const base = toNfkc(value)
    .replace(/[\s\u3000]/g, "")
    .toUpperCase();
  return /^\d+$/.test(base) ? base.replace(/^0+(?=\d)/, "") : base;
}

/** 人名の突き合わせキー。姓名間の空白を無視する */
export function normalizePersonName(value: string | null | undefined): string {
  return normalizeCompareKey(value);
}

/**
 * 年月の表記ゆれを "YYYY-MM" に揃える。
 * "2026/5" "2026-05" "2026年5月" "R8.5" "令和8年5月" を受ける。読めなければ null。
 */
export function normalizeYearMonth(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = toNfkc(value).replace(/[\s\u3000]/g, "");
  if (s === "") return null;

  const wareki = s.match(/^(?:令和|reiwa|R|r)\.?(\d{1,2})[年.\-/](\d{1,2})月?$/);
  if (wareki) {
    // 令和1年 = 2019年
    const year = 2018 + Number(wareki[1]);
    return formatYearMonth(year, Number(wareki[2]));
  }

  const seireki = s.match(/^(\d{4})[年.\-/](\d{1,2})月?$/);
  if (seireki) return formatYearMonth(Number(seireki[1]), Number(seireki[2]));

  const compact = s.match(/^(\d{4})(\d{2})$/);
  if (compact) return formatYearMonth(Number(compact[1]), Number(compact[2]));

  return null;
}

function formatYearMonth(year: number, month: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  if (year < 1900 || year > 2999) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export interface ParsedAmount {
  /** 読み取れた金額。読めなければ null */
  value: number | null;
  /** 元のセルが空欄だったか。0 と空欄は別物として扱う */
  blank: boolean;
}

/**
 * 金額の表記ゆれを吸収する。
 *
 * 空欄と 0 を区別して返すのが肝。「まだ入れていない」と「0円だった」を同じにすると、
 * 入力漏れが 0円の実績として静かに確定してしまう。
 *
 * 受ける表記: "1,234" "¥1,234" "１２３４" "(1,234)" "▲1,234" "△1,234" "-1,234" "1234円"
 */
export function parseAmountLoose(value: string | number | null | undefined): ParsedAmount {
  if (value == null) return { value: null, blank: true };
  if (typeof value === "number") {
    return Number.isFinite(value) ? { value, blank: false } : { value: null, blank: false };
  }

  const raw = toNfkc(value).trim();
  if (raw === "") return { value: null, blank: true };
  // "-" だけのセルは会計表で「該当なし」を意味する。0円の実績ではない
  if (/^[-−]$/.test(raw)) return { value: null, blank: true };

  let negative = false;
  let body = raw;

  // 括弧書き (1,234) と ▲ △ はどちらも会計表のマイナス表記
  const paren = body.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    body = paren[1] ?? "";
  }
  if (/^[▲△]/.test(body)) {
    negative = true;
    body = body.replace(/^[▲△]/, "");
  }
  if (/^[-−]/.test(body)) {
    negative = true;
    body = body.replace(/^[-−]/, "");
  }

  const cleaned = body.replace(/[,，]/g, "").replace(/[\u00a5\uffe5円\s\u3000]/g, "");
  if (cleaned === "") return { value: null, blank: true };
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { value: null, blank: false };

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, blank: false };
  return { value: negative ? -n : n, blank: false };
}

/**
 * 文字化けしていそうか。
 *
 * 元データは Shift_JIS のCSVで、UTF-8として読むと全体が化ける。
 * 化けた文字列をそのままマスタに入れると、次の月に正しく読めた文字列と一致せず、
 * 同じ運転者が2件に増える。取込の時点で気づけるようにする。
 */
export function looksLikeMojibake(value: string | null | undefined): boolean {
  if (!value) return false;
  // U+FFFD (置換文字) が出ていれば確定
  if (value.includes("�")) return true;
  // Shift_JIS のバイト列を Latin-1 として読むと、Latin-1補助の記号・アクセント文字が連続する。
  // 日本語の業務データに本来この並びは出ないので、割合が高ければ化けているとみなす。
  const suspicious = value.match(/[\u0080-\u00FF]/g);
  if (suspicious && suspicious.length >= 2 && suspicious.length / value.length > 0.3) return true;
  return false;
}

/**
 * 編集距離が max 以下かを判定する (max を超えたら早々に打ち切る)。
 * 「もしかして同じ?」の候補出しにだけ使う。自動で同一視はしない。
 */
export function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      curr.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev = curr;
  }
  return prev[b.length]! <= max;
}

/**
 * 2つの表記の関係。
 *   same               : 文字どおり同じ
 *   same_after_normalize: 書き方が違うだけ (全角/半角・空白・ゼロ埋め)。自動で吸収してよい
 *   near               : 1〜2文字違い。**自動で同一視してはいけない**。人に確認を出す
 *   different          : 別物
 */
export type ValueRelation = "same" | "same_after_normalize" | "near" | "different";

export function compareValues(
  a: string | null | undefined,
  b: string | null | undefined,
  options?: { kind?: "id" | "name" | "text" },
): ValueRelation {
  const rawA = a ?? "";
  const rawB = b ?? "";
  if (rawA === rawB) return "same";

  const normalize =
    options?.kind === "id"
      ? normalizeIdKey
      : options?.kind === "name"
        ? normalizePersonName
        : normalizeCompareKey;

  const keyA = normalize(rawA);
  const keyB = normalize(rawB);
  if (keyA === keyB) return "same_after_normalize";

  // 空文字との比較は「増えた/消えた」であって「似ている」ではない
  if (keyA === "" || keyB === "") return "different";

  // 2文字違いまでを候補にする。短い文字列で2文字違うと別物のことが多いので、
  // 3文字以下では1文字違いまでに絞る。
  const max = Math.min(keyA.length, keyB.length) <= 3 ? 1 : 2;
  return editDistanceWithin(keyA, keyB, max) ? "near" : "different";
}
