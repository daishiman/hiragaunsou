/**
 * 診断情報から、外に出してはいけないものを消す。
 *
 * 改善要望に自動で付く診断情報は、送った本人が中身を確かめない。
 * 確かめられないものを集める以上、「何を集めるか」ではなく
 * 「何が混ざっても消えるか」の側で安全を作る必要がある。
 * だからここは許可制ではなく、通す前に必ず通す関門として作ってある。
 *
 * 消す対象は3つ。
 *   1. 認証情報 — Cookie・Authorization・Bearer・JWT・APIキーらしい長い文字列
 *   2. 個人を指す情報 — メールアドレス・電話番号・カード番号らしい数字列
 *   3. URL やJSONの「鍵らしい名前」に付いた値 — token=、password:、apiKey: など
 *
 * 消した跡は残す (`***` ではなく `[マスク: 種類]`)。跡が消えると、
 * 管理者が「元から無かった」のか「消したのか」を区別できず、
 * 「情報が足りない」と誤って判断してしまう。
 */

/** 取得できなかった項目に入れる文字列。空欄と区別するために必ず入れる。 */
export const DIAGNOSTICS_UNAVAILABLE = "取得不可";

/** 鍵らしい名前。URL のクエリ・JSON のキー・`key=value` 形式の全てで使う。 */
const SECRET_KEY_PATTERN =
  /(?:authorization|auth|token|access[_-]?token|refresh[_-]?token|id[_-]?token|session|sid|cookie|password|passwd|pwd|secret|api[_-]?key|apikey|client[_-]?secret|signature|sig|credential|state|nonce|code)/i;

/** 消す順に並べた規則。先に消したものが後の規則で再び壊されないよう、長いものから消す。 */
const RULES: readonly { readonly re: RegExp; readonly to: string }[] = [
  // JWT (ヘッダ.ペイロード.署名)。中身にメールや権限が入るため最優先で落とす。
  { re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, to: "[マスク: トークン]" },
  // Authorization ヘッダの値
  { re: /\b(?:Bearer|Basic|Digest)\s+[A-Za-z0-9._~+/=-]{8,}/gi, to: "[マスク: 認証ヘッダ]" },
  // Cookie 1本まるごと (better-auth のセッションCookieを含む)
  { re: /\b[A-Za-z0-9_.-]*(?:session|token|auth)[A-Za-z0-9_.-]*=[^;\s"']{8,}/gi, to: "[マスク: Cookie]" },
  // メールアドレス
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, to: "[マスク: メール]" },
  // カード番号らしい数字列。区切り付き4桁×4、または16桁続き。
  // 13桁を対象にすると時刻 (epoch ミリ秒) まで消してしまい、いつ起きたかが読めなくなる。
  { re: /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b|\b\d{16}\b/g, to: "[マスク: 番号]" },
  // 日本の電話番号
  { re: /\b0\d{1,4}-\d{1,4}-\d{3,4}\b/g, to: "[マスク: 電話]" },
];

/**
 * `鍵らしい名前 = 値` / `"鍵らしい名前": "値"` の値だけを消す。
 *
 * 名前で消すのは、値そのものの見た目では判断できないものがあるため
 * (6桁の確認コードは、ただの数字と区別が付かない)。
 */
/** 既に伏せ済みの値。二重に伏せると跡の形が崩れ、読む人が意味を取れなくなる。 */
function alreadyMasked(value: string): boolean {
  return value.replace(/^"/, "").startsWith("[マスク");
}

function maskByKeyName(text: string): string {
  return (
    text
      // JSON: "token": "abc" / "token":123
      .replace(
        /("?)([A-Za-z0-9_-]+)\1(\s*:\s*)("(?:[^"\\]|\\.)*"|[^,}\s]+)/g,
        (whole, q: string, key: string, sep: string, value: string) =>
          SECRET_KEY_PATTERN.test(key) && !alreadyMasked(value)
            ? `${q}${key}${q}${sep}"[マスク: 値]"`
            : whole,
      )
      // クエリ・フォーム: token=abc&... / token=abc; ...
      .replace(/([A-Za-z0-9_-]+)=([^&;\s"']+)/g, (whole, key: string, value: string) =>
        SECRET_KEY_PATTERN.test(key) && !alreadyMasked(value) ? `${key}=[マスク: 値]` : whole,
      )
  );
}

/**
 * 診断情報に載せる文字列を、外に出せる形にする。
 *
 * @param text 元の文字列
 * @param maxLength 残す長さ。超えた分は落とし、落としたことを末尾に書く
 */
export function maskSensitive(text: string, maxLength = 500): string {
  if (!text) return "";
  // 形で分かるものを先に落とす。名前で消す方を先に回すと、
  // `Authorization: Bearer xxx` の「Authorization:」までしか消えず、
  // 値そのものが素で残る (鍵と値が空白で切れているため)。
  let masked = text;
  for (const rule of RULES) masked = masked.replace(rule.re, rule.to);
  masked = maskByKeyName(masked);
  if (masked.length <= maxLength) return masked;
  return `${masked.slice(0, maxLength)}…(以下${masked.length - maxLength}文字を省略)`;
}

/**
 * URL を、パスは残しつつクエリの値だけ伏せた形にする。
 *
 * パスは「どのAPIで失敗したか」を示す唯一の手がかりなので残す。
 * クエリは、鍵らしい名前でなくても検索語や対象月など本人が意図しない情報が
 * 入り得るため、名前だけ残して値は伏せる。
 */
export function maskUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  const [head = "", query] = rawUrl.split("?");
  const path = maskSensitive(head, 300);
  if (!query) return path;
  const keys = query
    .split("&")
    .map((pair) => pair.split("=")[0] ?? "")
    .filter(Boolean)
    .map((key) => `${key}=[伏せ字]`)
    .join("&");
  return keys ? `${path}?${keys}` : path;
}

/**
 * 押された要素を「どれか」だけ分かる形にする。
 *
 * 入力欄の中身・表の数字といった値は載せない。載せると、足あとを見るだけで
 * 業務の数字が読めてしまい、診断のために集めたものが情報の持ち出し口になる。
 */
export function elementIdentity(el: {
  tagName?: string;
  id?: string;
  className?: unknown;
  getAttribute?: (name: string) => string | null;
}): string {
  const tag = (el.tagName ?? "?").toLowerCase();
  const parts = [tag];
  if (el.id) parts.push(`#${el.id}`);
  const testId = el.getAttribute?.("data-testid");
  if (testId) parts.push(`[data-testid=${testId}]`);
  const label = el.getAttribute?.("aria-label");
  // aria-label は「保存」「閉じる」といった操作名。業務の値は入らない前提だが、
  // 万一入っても読めないよう長さを切る。
  if (label) parts.push(`[aria-label=${label.slice(0, 40)}]`);
  const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2) : [];
  for (const c of cls) if (c) parts.push(`.${c}`);
  return maskSensitive(parts.join(""), 120);
}
