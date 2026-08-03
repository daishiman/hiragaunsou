import Encoding from "encoding-japanese";

/**
 * cp932(Shift_JIS系) でエンコードされたCSVバイト列をUTF-8文字列にデコードする。
 * Cloudflare Workers の `TextDecoder` は utf-8 系のみサポートのため、
 * 純JS実装の `encoding-japanese` を使う(Node の `Buffer`/`iconv-lite` に依存しない)。
 */
export function decodeCp932(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const unicodeArray = Encoding.convert(Array.from(bytes), {
    to: "UNICODE",
    from: "SJIS",
  });
  return Encoding.codeToString(unicodeArray);
}
