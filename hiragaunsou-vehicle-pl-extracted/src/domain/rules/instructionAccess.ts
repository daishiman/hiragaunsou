/**
 * Claude Code に指示文を読ませるための鍵と、画像の期限付きURL。
 *
 * 指示文には業務の言葉・画面の中身・エラーの中身が載る。管理画面と同じものを
 * ログインなしで読める入口を作る以上、守りは次の3つで固める。
 *
 *   1. 鍵が要る      … 無認証では1件も読めない
 *   2. 範囲が狭い    … 鍵は「渡した件」だけを開ける (全件を開ける鍵を配らない)
 *   3. 期限が切れる  … 渡した鍵は放っておいても必ず死ぬ
 *
 * 鍵そのものは保存しない。保存するのは指紋 (SHA-256) だけで、
 * 平文は発行した瞬間に1度だけ画面へ出す。DB を読める人が鍵を使えてはいけない。
 */

/* ───────────────────────── 鍵 ───────────────────────── */

/** 鍵の頭に付ける印。ログや貼り間違いの中から「これは鍵だ」と気づけるようにする。 */
export const TOKEN_PREFIX = "hgcc_";

/** 鍵の既定の寿命 (日)。放っておいても切れる長さで、作業1回分には足りる。 */
export const TOKEN_DEFAULT_DAYS = 7;
/** 鍵に許す最長の寿命 (日)。これ以上は選べない。 */
export const TOKEN_MAX_DAYS = 30;

/**
 * 「全件を読める鍵」だけに課す重み。
 *
 * 範囲を空にした鍵は、発行済みの要望をすべて開ける。1本漏れると全部が読まれるので、
 * 渡した件だけの鍵と同じ手軽さで作れてはいけない。重みの付け方は次の2つにした。
 *
 *   - 期限を短くする … 既定1日・最長3日 (渡した件だけの鍵は既定7日・最長30日)
 *   - 理由を必ず書かせる … 後から見た人が「なぜ全件なのか」を辿れる
 *
 * 押す手数をわざと増やすのではなく、残るもの (期限と理由) を増やす形にしている。
 * 手数だけ増やしても、慣れれば素通りするだけで安全にはならない。
 */
export const TOKEN_ALL_SCOPE_DEFAULT_DAYS = 1;
export const TOKEN_ALL_SCOPE_MAX_DAYS = 3;

/** 全件を読める鍵の理由に求める最小の長さ。「対応」「確認」だけで通らない長さにする。 */
export const TOKEN_ALL_SCOPE_REASON_MIN = 5;

/**
 * 全件を読める鍵の記録を、どの要望に紐づけるか。
 *
 * 範囲を持たない鍵なので、紐づけ先の要望が1件も無い。記録を書かないと
 * 「一番強い鍵だけ記録が残らない」ことになるため、この決まった名前で残す。
 */
export const ALL_SCOPE_AUDIT_ID = "(全件を読める鍵)";

/**
 * CI 用の鍵の記録を、どの要望に紐づけるか。
 *
 * この鍵も範囲を持たない (どの件でも状態だけは進められる)。同じ理由で、
 * 決まった名前で1行残す。ここを空にすると、GitHub Secrets に置いた鍵が
 * 「いつ誰が作ったか分からないまま動き続ける」ことになる。
 */
export const CI_TOKEN_AUDIT_ID = "(CIが状態を更新する鍵)";

/** 全件を読める鍵を断る理由 (作ってよいなら null)。 */
export function allScopeTokenRejection(input: { reason: string; days: number }): string | null {
  if (input.reason.trim().length < TOKEN_ALL_SCOPE_REASON_MIN) {
    return `全件を読める鍵は、何のために作るのかを${TOKEN_ALL_SCOPE_REASON_MIN}文字以上で書いてください（記録に残ります）。`;
  }
  if (!Number.isFinite(input.days) || input.days < 1 || input.days > TOKEN_ALL_SCOPE_MAX_DAYS) {
    return `全件を読める鍵の有効期間は1日〜${TOKEN_ALL_SCOPE_MAX_DAYS}日で指定してください。`;
  }
  return null;
}

export interface IssuedToken {
  /** 平文。発行の応答にだけ入れ、保存しない。 */
  token: string;
  /** 保存する側。これから平文には戻せない。 */
  hash: string;
}

export async function generateAccessToken(): Promise<IssuedToken> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = `${TOKEN_PREFIX}${base64url(bytes)}`;
  return { token, hash: await hashAccessToken(token) };
}

export async function hashAccessToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return hex(new Uint8Array(digest));
}

/**
 * 画面に出す形。発行のとき以外は、これしか見せない。
 *
 * 末尾ではなく先頭を残す。末尾を残すと、複数の鍵を見分けるために
 * 鍵の中身そのものを覚えることになる。
 */
export function maskToken(token: string): string {
  const head = token.slice(0, TOKEN_PREFIX.length + 4);
  return `${head}${"…".padEnd(4, "…")}`;
}

export function tokenExpiresAt(now: Date, days: number): Date {
  const clamped = Math.min(Math.max(Math.trunc(days), 1), TOKEN_MAX_DAYS);
  return new Date(now.getTime() + clamped * 24 * 60 * 60 * 1000);
}

/* ───────────────────────── 鍵にできること ───────────────────────── */

/**
 * 鍵に持たせる権限。この3つ以外は作らない。
 *
 *   read       … 指示文を読む
 *   status:own … 自分が読み取った要望だけ、状態を進める (手元の開発者用)
 *   status:any … 読まずに状態だけ進める (GitHub Actions 用)
 *
 * 「読む」と「書く」を1つにまとめないのが肝心なところ。CI に渡す鍵は
 * PR がマージされたことを伝えるだけでよく、要望の中身 (利用者が書いた文・画面の写し) を
 * 読める必要が無い。まとめてしまうと、GitHub Secrets が漏れた時点で
 * 個人情報を含む指示文まで全部読まれる。
 *
 * status:own と status:any を分けるのも同じ理由で、手元の開発者用の鍵に
 * 「触っていない要望まで閉じられる」力を持たせない。
 */
export const TOKEN_ABILITIES = ["read", "status:own", "status:any"] as const;
export type TokenAbility = (typeof TOKEN_ABILITIES)[number];

/** 手元の開発者に渡す鍵の既定。読んで、読んだ件だけ進められる。 */
export const DEVELOPER_ABILITIES: TokenAbility[] = ["read", "status:own"];
/** GitHub Actions に置く鍵。状態を進めることしかできない (指示文は読めない)。 */
export const CI_ABILITIES: TokenAbility[] = ["status:any"];

export function isTokenAbility(value: string): value is TokenAbility {
  return (TOKEN_ABILITIES as readonly string[]).includes(value);
}

export function parseAbilities(raw: string | null): TokenAbility[] {
  if (!raw) return ["read"];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return ["read"];
    const list = v.filter((x): x is TokenAbility => typeof x === "string" && isTokenAbility(x));
    // 空になったら「読むだけ」に落とす。権限の列が壊れていたときに
    // 何でもできる鍵になるのではなく、一番弱い鍵になる側へ倒す。
    return list.length > 0 ? list : ["read"];
  } catch {
    return ["read"];
  }
}

export interface TokenRecord {
  expiresAt: Date;
  revokedAt: Date | null;
  /** 開けられる要望の id。空なら「発行済みのすべて」。 */
  scopeIds: string[];
  /** できること。既存の鍵 (列が無かった頃のもの) は読むだけとして扱う。 */
  abilities: TokenAbility[];
  /**
   * この鍵が属する会社の id。
   *
   * いまは単一の会社しか扱っておらず、会社の表そのものが無いので必ず null。
   * マルチテナントにするときに会社IDを焼き込むのは **ここ1点** で、
   * 発行時にセッションの会社IDを入れ、参照側は tokenCompanyRejection() で弾く。
   * 鍵ごとに会社を持たせておけば、要望の取り違えは「鍵が違う」で止まる。
   */
  companyId: string | null;
}

/** 鍵が使えない理由 (使えるなら null)。断る理由は必ず日本語で返す。 */
export function tokenRejection(token: TokenRecord | null, now: Date): string | null {
  if (!token) return "この鍵は使えません。管理画面で新しく発行してください。";
  if (token.revokedAt !== null) return "この鍵は失効しています。管理画面で新しく発行してください。";
  if (token.expiresAt.getTime() <= now.getTime()) {
    return "この鍵は期限が切れています。管理画面で新しく発行してください。";
  }
  return null;
}

/**
 * その鍵でその要望を開けるか。
 *
 * 範囲を空にした鍵 (すべてを開ける鍵) も作れるが、既定は「渡した件だけ」。
 * 画面から「Claude Code に渡す」を押したときは、必ず押した件だけの範囲になる。
 */
export function tokenAllows(token: TokenRecord, requestId: string): boolean {
  return token.scopeIds.length === 0 || token.scopeIds.includes(requestId);
}

/** 鍵が「読む」ことを許されているか (許されないなら理由を返す)。 */
export function readRejection(token: TokenRecord): string | null {
  if (token.abilities.includes("read")) return null;
  return "この鍵では指示文を読めません（状態を進めるためだけの鍵です）。";
}

/**
 * 鍵が「状態を進める」ことを許されているか。
 *
 * status:own の鍵は、自分がその要望の指示文を読み取っていることが条件。
 * 読んでいない件まで閉じられると、手元の1本で他人の作業を「対応済み」にできてしまう。
 * 読み取りの記録 (claim) を条件にすることで、権限の範囲が
 * 「実際にやった仕事」と自動的に一致する。
 */
export function statusChangeRejection(token: TokenRecord, hasClaim: boolean): string | null {
  if (token.abilities.includes("status:any")) return null;
  if (!token.abilities.includes("status:own")) {
    return "この鍵では状態を変えられません。";
  }
  if (!hasClaim) {
    return "この鍵で取得していない要望です。指示文を取得してから状態を進めてください。";
  }
  return null;
}

/**
 * 会社の境界。単一の会社しか無いいまは必ず通る。
 *
 * マルチテナント化のときは、要望側にも会社IDを持たせてここへ渡す。
 * 呼ぶ場所を先に作っておくのは、後から「どこで確かめるか」を探し直すと
 * 抜けが出るため (通っている道の上に置いておく)。
 */
export function tokenCompanyRejection(
  token: TokenRecord,
  requestCompanyId: string | null,
): string | null {
  if (token.companyId === null || requestCompanyId === null) return null;
  if (token.companyId === requestCompanyId) return null;
  return "この鍵では扱えない要望です。";
}

/** 記録に残す主体の呼び名。どちらの鍵による更新かを後から数えられるようにする。 */
export function tokenActorName(token: { name: string; id: string; abilities: TokenAbility[] }): string {
  const kind = token.abilities.includes("status:any") ? "CI" : "開発者";
  return `鍵(${kind}): ${token.name || token.id}`;
}

export function parseScopeIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 発行した鍵を、開発者の手元に置いてもらうための案内文。
 *
 * **Claude Code に貼る文ではない。** 以前はここで「Claude に貼る1行」を組み立てていたが、
 * その形だと鍵が Claude の入力欄を通り、会話の履歴・要約・ログに残ってしまう。
 * 残ったものは取り消せないので、鍵の通り道を「人 → 1Password → 道具」に変え、
 * Claude の側は鍵を一度も見ない形にした。
 *
 * この文の宛先は、鍵を受け取る開発者ひとり。貼り先は 1Password と設定ファイルで、
 * 設定ファイルに書くのは鍵そのものではなく「1Password のどこにあるか」だけ。
 */
export function tokenSetupNote(appOrigin: string, token: string): string {
  const origin = appOrigin.replace(/\/$/, "");
  return [
    "この鍵は Claude Code に貼らないでください。1Password に預けて使います。",
    "",
    "1. 1Password に項目を1つ作り、次の値を credential として保存します。",
    `   ${token}`,
    "",
    "2. アプリのフォルダに .env.improvement を作り、次の1行だけを書きます。",
    "   （鍵そのものは書きません。1Password のどこにあるかを書きます）",
    '   HGCC_TOKEN="op://保管庫の名前/項目の名前/credential"',
    "",
    "3. 手元のアプリではなくこのサーバを見せたいときだけ、次の1行も足します。",
    "   書かなければ手元のアプリ (localhost:8787) を見ます。",
    `   HGCC_BASE_URL="${origin}"`,
    "",
    "あとは Claude Code で /improvements と打つだけです。鍵は道具が自分で取り出します。",
  ].join("\n");
}

/** `Authorization: Bearer <鍵>` から鍵を取り出す。無ければ null。 */
export function bearerTokenOf(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/* ───────────────────────── 画像の期限付きURL ───────────────────────── */

/**
 * 画面の写しを、鍵を持たない相手にも一定時間だけ見せるための署名。
 *
 * 画像そのものを外のサービスへ置かない。置いた瞬間に、消す権限も期限も
 * こちらの手を離れるため。代わりに、このアプリが自分で配り、期限で閉じる。
 */
export interface ShotSignature {
  exp: number;
  sig: string;
}

export async function signShotUrl(
  requestId: string,
  expiresAt: Date,
  secret: string,
): Promise<ShotSignature> {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  return { exp, sig: await hmac(`${requestId}.${exp}`, secret) };
}

/** 署名が正しく、期限内か。合わない理由は返さない (総当たりの手がかりにしない)。 */
export async function verifyShotUrl(
  requestId: string,
  exp: number,
  sig: string,
  secret: string,
  now: Date,
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp * 1000 <= now.getTime()) return false;
  const expected = await hmac(`${requestId}.${exp}`, secret);
  return timingSafeEqual(expected, sig);
}

async function hmac(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64url(new Uint8Array(mac));
}

/**
 * 長さと中身を、途中で抜けずに比べる。
 * 先に違いが出た時点で false を返すと、返るまでの時間から正解が絞られる。
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
}
