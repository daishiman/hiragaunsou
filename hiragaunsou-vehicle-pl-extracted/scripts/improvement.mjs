#!/usr/bin/env node
/**
 * 改善要望の指示文を取りに行く道具。
 *
 * ここが守っている一番大事なこと:
 *   **鍵 (トークン) を標準出力にも標準エラーにも絶対に出さない。**
 *
 * この道具の出力は Claude Code がそのまま読む。鍵が1文字でも混ざれば、
 * 会話の履歴・要約・ログのすべてに鍵が残る。取り消す手段は無い。
 * だから鍵は「環境変数からこのプロセスに入り、Authorization ヘッダとして出ていくだけ」で、
 * それ以外のどの経路にも流さない。
 *
 * 具体的には次の3つで担保している。
 *   1. 鍵を読むのは redact() を通す前の1箇所だけ (下の readToken)
 *   2. 画面に出す文字列はすべて say() / die() を通り、そこで鍵の文字列を伏せる
 *   3. 通信の失敗もこちらで文面を作り直す (ライブラリのエラーをそのまま出さない)
 *
 * 標準出力には指示文だけを出す。進み具合や警告は標準エラーへ回す。
 * 混ぜると、Claude Code が読む文書に手順の話が紛れ込む。
 *
 * 使い方:
 *   node scripts/improvement.mjs list
 *   node scripts/improvement.mjs get <要望id> [<要望id> ...]
 *   node scripts/improvement.mjs pr-opened <要望id> --pr <PRのURL>
 *   node scripts/improvement.mjs pr-merged <要望id> --pr <PRのURL>
 *   node scripts/improvement.mjs pr-closed <要望id>
 */

import { redact, TOKEN_PREFIX } from "./redact.mjs";

/**
 * つなぎ先の既定は手元のアプリ。
 *
 * 本番を既定にしない。事故で本番の要望を取り込み、本番のデータで動かしてしまう状況を
 * 「何も設定しなければそうなる」形にしてはいけない。本番を見るときは必ず明示させる。
 */
const DEFAULT_BASE_URL = "http://localhost:8787";

/* ───────────────────────── 鍵の取り扱い ───────────────────────── */

/**
 * 鍵を環境変数から1回だけ読む。
 *
 * 環境変数へ入れるのは 1Password CLI (`op run --`) の役目で、その場合この値は
 * このプロセスの中にしか存在しない。シェルに export された恒久的な値ではない。
 */
function readToken() {
  const token = process.env.HGCC_TOKEN;
  if (!token || token.trim().length === 0) {
    die(
      [
        "鍵が渡されていません。",
        "",
        "  1Password を使う場合:  pnpm run improvement -- <コマンド>",
        "  使わない場合:          HGCC_TOKEN=… node scripts/improvement.mjs <コマンド>",
        "",
        "鍵の作り方は docs/product/claude-code-improvement-guide.md を見てください。",
      ].join("\n"),
    );
  }
  if (!token.startsWith(TOKEN_PREFIX)) {
    // 中身は出さない。「違うものが入っている」ことだけ伝える。
    die(`鍵の形が違います（${TOKEN_PREFIX} で始まる鍵を渡してください）。`);
  }
  return token.trim();
}

let activeToken = null;

/** 人に向けた案内。標準エラーへ出す (標準出力は指示文専用)。 */
function say(message) {
  process.stderr.write(`${redact(message, activeToken)}\n`);
}

/** 止まるときの一言。ここも必ず伏せ字を通す。 */
function die(message) {
  process.stderr.write(`${redact(message, activeToken)}\n`);
  process.exit(1);
}

/** 指示文そのもの。ここだけが標準出力を使う。 */
function emit(text) {
  process.stdout.write(redact(text, activeToken));
}

/* ───────────────────────── 通信 ───────────────────────── */

function baseUrl() {
  const raw = (process.env.HGCC_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  if (!/^https?:\/\//.test(raw)) {
    die("HGCC_BASE_URL は http:// か https:// で始まる URL にしてください。");
  }
  return raw;
}

/**
 * API を叩く。
 *
 * 失敗したときの文面はこちらで作り直す。fetch の例外をそのまま出すと、
 * 実装によってはリクエストの中身 (ヘッダを含む) が文面に載ることがある。
 * 出してよいのは「どこへ・どうなったか」までで、何を持って行ったかは出さない。
 */
async function call(path, init = {}) {
  const url = `${baseUrl()}${path}`;
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${activeToken}`,
      },
    });
  } catch {
    die(`${url} につながりませんでした。アプリが動いているか確認してください。`);
  }

  const text = await response.text();
  if (!response.ok) {
    // サーバが返す断り文句は日本語で、鍵の中身は含まない。それでも念のため伏せ字を通す。
    die(`取得できませんでした（${response.status}）。\n${text.slice(0, 1000)}`);
  }
  return text;
}

/* ───────────────────────── それぞれの操作 ───────────────────────── */

async function commandList() {
  const text = await call("/api/instructions?format=json");
  const data = JSON.parse(text);
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) {
    emit("渡された改善要望はありません。\n");
    return;
  }
  // 一覧は「どれを直すか選ぶため」の情報だけにする。本文まで出すと、
  // 選ぶ前に全件の中身が Claude Code の文脈へ乗る。
  const lines = items.map(
    (i) => `- ${i.id}  [優先度 ${i.priority}／${i.kind}] ${i.title ?? i.screenLabel ?? ""}`,
  );
  emit(`渡されている改善要望 ${items.length}件（優先度の高い順）\n\n${lines.join("\n")}\n`);
}

async function commandGet(ids) {
  const query = ids.length > 0 ? `?id=${ids.map(encodeURIComponent).join(",")}` : "";
  emit(await call(`/api/instructions${query}`));
}

async function commandStatus(event, id, prUrl) {
  if (!id) die("要望の id を指定してください。");
  const body = { event };
  if (prUrl) body.prUrl = prUrl;
  const text = await call(`/api/instructions/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = JSON.parse(text);
  say(data.message ?? "状態を更新しました。");
}

/* ───────────────────────── 入口 ───────────────────────── */

function parseArgs(argv) {
  const rest = [];
  let pr = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--pr") {
      pr = argv[i + 1] ?? null;
      i += 1;
    } else if (argv[i].startsWith("--pr=")) {
      pr = argv[i].slice("--pr=".length);
    } else {
      rest.push(argv[i]);
    }
  }
  return { rest, pr };
}

async function main() {
  const { rest, pr } = parseArgs(process.argv.slice(2));
  const [command, ...args] = rest;

  activeToken = readToken();
  // どこへつなぐか・鍵をどこから取ったかは毎回出す。本番へ向いていることに
  // 気づかないまま作業する状況を作らない。
  say(`接続先: ${baseUrl()}／鍵の取り出し元: ${process.env.HGCC_SOURCE || "環境変数"}`);

  switch (command) {
    case "list":
      return commandList();
    case "get":
      return commandGet(args);
    case "pr-opened":
      return commandStatus("pr_opened", args[0], pr);
    case "pr-merged":
      return commandStatus("pr_merged", args[0], pr);
    case "pr-closed":
      return commandStatus("pr_closed", args[0], pr);
    default:
      die(
        [
          "使い方:",
          "  list                         渡されている要望の一覧",
          "  get [id ...]                 指示文を取得（idを省くと鍵の範囲すべて）",
          "  pr-opened <id> --pr <URL>    確認依頼を作ったことを知らせる",
          "  pr-merged <id> --pr <URL>    本番へ反映したことを知らせる",
          "  pr-closed <id>               確認依頼を取り下げたことを知らせる",
        ].join("\n"),
      );
  }
}

main().catch((error) => {
  // 例外の中身をそのまま出さない。想定外の失敗でも、出るのはこの一文だけ
  // (伏せ字は say の中で必ず掛かる)。
  say(`予期しない失敗: ${error?.message ?? "詳細不明"}`);
  process.exit(1);
});
