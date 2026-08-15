/**
 * 受け取る JSON の大きさに上限を掛けてから読む。
 *
 * content-length の名乗りだけを見るのでは足りない (名乗らずに送れる)。
 * 読みながら実際のバイト数も数え、超えた時点で読むのをやめる。
 * 画像を含む投稿が Worker のメモリを無制限に使わないための共通の境界。
 */

export class RequestBodyTooLargeError extends Error {}
export class RequestBodyInvalidError extends Error {}

export async function readJsonBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) throw new RequestBodyTooLargeError();

  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyInvalidError();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestBodyInvalidError();
  }
}
