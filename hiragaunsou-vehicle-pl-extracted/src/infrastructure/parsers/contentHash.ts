/**
 * ファイルの中身の指紋(SHA-256)。
 *
 * 「同じファイルをもう一度取り込もうとしていないか」をファイル名ではなく中身で判定するために使う。
 * 社内のファイル名は毎月同じまま中身だけ入れ替わることも、名前だけ変えて中身が同じこともあるため、
 * 名前は参考情報にとどめ、同一判定はこの値だけで行う(docs/product/file-import-common-spec.md §3-5)。
 *
 * Workers・ブラウザ・Node.js のいずれにも入っている WebCrypto を使う(追加依存なし)。
 */
export async function computeContentHash(content: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", content);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
