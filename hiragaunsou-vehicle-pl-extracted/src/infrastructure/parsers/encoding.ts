/**
 * cp932(Shift_JIS系) でエンコードされたCSVバイト列をUTF-8文字列にデコードする。
 *
 * workerd(Cloudflare Workers)の `TextDecoder` は WHATWG Encoding標準の "shift_jis" ラベルを
 * ネイティブ実装しており、これは Windows-31J(= cp932)相当の拡張文字表を含むためcp932の
 * デコードにそのまま使える。
 *
 * 以前は純JS実装の `encoding-japanese`(`Array.from(bytes)` でバイト列を1要素ずつ配列化し、
 * 文字単位でテーブル変換する実装)を使っていたが、これは実データ規模(数百KB〜数MBのCSV)で
 * 数十〜数百ms、大きいファイルでは秒単位のCPU時間を消費する。Cloudflare Workersは
 * 1リクエストあたりのCPU時間に上限があり(無料プランは既定10ms)、これを超えると
 * 処理が強制終了されレスポンスが返らないまま接続が切れる。クライアント側はこれを
 * 「取り込んでいます…」の表示のまま応答が返らない = 画面が固まったように見える形で
 * 観測していた。ネイティブ実装に置き換えることでCPU時間を数桁削減する。
 */
export function decodeCp932(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return new TextDecoder("shift_jis").decode(bytes);
}
