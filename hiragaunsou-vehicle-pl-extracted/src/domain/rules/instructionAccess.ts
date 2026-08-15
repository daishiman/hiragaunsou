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

export interface TokenRecord {
  expiresAt: Date;
  revokedAt: Date | null;
  /** 開けられる要望の id。空なら「発行済みのすべて」。 */
  scopeIds: string[];
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
 * Claude Code にそのまま貼る文。
 *
 * 鍵を使うのは非エンジニアで、貼り先は Claude Code の入力欄1つだけ。
 * だから「何をしてほしいか」と「取りに行く先」を1つの塊にし、コピーを1回で済ませる。
 * 組み立てをここに置くのは、URL の作り方を画面とサーバの2箇所に持たないため。
 */
export function claudeCodeCommand(appOrigin: string, token: string): string {
  const origin = appOrigin.replace(/\/$/, "");
  return [
    "次のコマンドを実行して、返ってきた改善要望をすべて直してください。",
    "件ごとに受け入れ条件が書いてあります。すべて満たしてから次の件へ進んでください。",
    "",
    `curl -sS -H "Authorization: Bearer ${token}" "${origin}/api/instructions"`,
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
