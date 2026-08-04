/**
 * AI連携用APIキー(Anthropic/OpenAI/Google/xAI)の暗号化ユーティリティ。
 *
 * ★ ここで暗号化したAPIキーは、この関数群を通じてサーバー側 (admin権限チェック済みの
 *   Route Handler) からしか復号できない。復号鍵 (env.API_KEY_ENCRYPTION_SECRET) は
 *   Cloudflare Workers Secrets にのみ存在し、D1データベースには一切保存しない。
 *   D1が漏洩しても暗号文だけでは平文キーを復元できない構造にするための分離であり、
 *   この鍵をクライアント(ブラウザ)やAPIレスポンスに露出させてはならない。
 *
 * AES-GCM (Web Crypto API) を使う。Cloudflare Workers ランタイムは Node の `crypto` モジュールに
 * 依存せず標準の `crypto.subtle` を持つため、追加の依存パッケージなしで完結する。
 */

const ALGO = "AES-GCM";
/** GCMの推奨IV長は96bit (12byte)。長くしても安全性は上がらず、標準に合わせる。 */
const IV_LENGTH_BYTES = 12;

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * env.API_KEY_ENCRYPTION_SECRET (base64・32byte / `openssl rand -base64 32` で生成) を
 * AES-256-GCM の鍵としてインポートする。
 */
async function importKey(secretBase64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(secretBase64);
  if (raw.length !== 32) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET は32byte(base64)である必要があります。`openssl rand -base64 32` で生成してください。",
    );
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, ALGO, false, ["encrypt", "decrypt"]);
}

export interface EncryptedApiKey {
  /** 暗号文 (base64) */
  cipher: string;
  /** この暗号化で使ったIV (base64)。復号時に同じ値が必要。 */
  iv: string;
  /** 一覧表示用: キー末尾4文字 (平文はここにしか残らないので呼び出し側で即座に破棄する) */
  last4: string;
}

/** 平文APIキーを暗号化する。 */
export async function encryptApiKey(
  plainApiKey: string,
  secretBase64: string,
): Promise<EncryptedApiKey> {
  const key = await importKey(secretBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    new TextEncoder().encode(plainApiKey),
  );
  return {
    cipher: bytesToBase64(new Uint8Array(cipherBuf)),
    iv: bytesToBase64(iv),
    last4: plainApiKey.slice(-4),
  };
}

/**
 * 暗号化されたAPIキーを復号する。
 * 呼び出しはAI呼び出し直前(サーバー側)に限定し、復号結果を画面・APIレスポンスに含めない。
 */
export async function decryptApiKey(
  encrypted: Pick<EncryptedApiKey, "cipher" | "iv">,
  secretBase64: string,
): Promise<string> {
  const key = await importKey(secretBase64);
  const plainBuf = await crypto.subtle.decrypt(
    { name: ALGO, iv: base64ToBytes(encrypted.iv) as BufferSource },
    key,
    base64ToBytes(encrypted.cipher) as BufferSource,
  );
  return new TextDecoder().decode(plainBuf);
}
