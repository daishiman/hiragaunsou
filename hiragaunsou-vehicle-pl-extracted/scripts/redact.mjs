/**
 * 鍵 (トークン) を文字列から伏せる。
 *
 * 取得スクリプトの出力は Claude Code がそのまま読む。鍵が1文字でも混ざれば、
 * 会話の履歴・要約・ログのすべてに鍵が残り、取り消す手段が無い。
 * そのため、画面へ出る文字列は必ずここを通す。
 *
 * 別ファイルにしてあるのは、テストから副作用なしに読み込めるようにするため。
 * 取得スクリプト本体を import すると、読み込んだだけで通信が始まってしまう。
 */

/** 鍵の頭に付いている印 (サーバ側の TOKEN_PREFIX と揃える)。 */
export const TOKEN_PREFIX = "hgcc_";

/**
 * 渡された鍵そのものに加えて、hgcc_ で始まる塊をすべて伏せる。
 *
 * 「いま使っている鍵と一致するものだけ」を消す作りにすると、
 * 別の鍵が何かの拍子に混ざったときに素通りする。形で消すほうを主にしておく。
 */
export function redact(text, token) {
  let out = String(text ?? "");
  if (token) out = out.split(token).join("[鍵は伏せています]");
  return out.replace(new RegExp(`${TOKEN_PREFIX}[A-Za-z0-9_-]+`, "g"), "[鍵は伏せています]");
}
