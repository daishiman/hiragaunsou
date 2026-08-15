import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

/**
 * 取得スクリプトが、鍵 (トークン) を1文字も外へ出さないことを確かめる。
 *
 * これが今回いちばん大事な検証になる。スクリプトの出力は Claude Code がそのまま読み、
 * 読まれたものは会話の履歴・要約・ログに残る。取り消す手段は無い。
 * 「気をつけて書いた」では守れないので、実際にプロセスを起こして
 * **標準出力にも標準エラーにも鍵が現れないこと** を機械で確かめる。
 *
 * 上手くいく場合だけでなく、断られた場合・つながらない場合も見る。
 * 漏れるとしたら、たいてい失敗したときの文面のほうだから。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "../../scripts/improvement.mjs");

/** 本物と同じ形の、この検証のためだけの鍵。 */
const TOKEN = "hgcc_TESTONLYzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

const run = promisify(execFile);

interface Outcome {
  stdout: string;
  stderr: string;
  code: number;
}

async function runScript(args: string[], env: Record<string, string>): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], {
      env: { PATH: process.env.PATH ?? "", HGCC_TOKEN: TOKEN, ...env },
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

/** 出力のどこにも鍵が無いこと。伏せ字に置き換わっているのは構わない。 */
function expectNoLeak(outcome: Outcome) {
  expect(outcome.stdout).not.toContain(TOKEN);
  expect(outcome.stderr).not.toContain(TOKEN);
  // 形で見ても引っかからないこと (別の鍵が混ざった場合を含む)
  expect(outcome.stdout).not.toMatch(/hgcc_[A-Za-z0-9_-]{20,}/);
  expect(outcome.stderr).not.toMatch(/hgcc_[A-Za-z0-9_-]{20,}/);
}

/* ───────────────────────── 相手役のサーバ ───────────────────────── */

let server: Server;
let origin = "";
/** サーバが受け取った Authorization ヘッダ。鍵がちゃんと届いていることの確認に使う。 */
let receivedAuth: string | null = null;
/** 次の応答をどうするか。断り方を差し替えて、失敗時の文面も見る。 */
let respond: (path: string) => { status: number; body: string; type: string };

beforeAll(async () => {
  respond = () => ({ status: 200, body: "# 指示文\n\n直してください。\n", type: "text/markdown" });
  server = createServer((req, res) => {
    receivedAuth = req.headers.authorization ?? null;
    const r = respond(req.url ?? "");
    res.writeHead(r.status, { "content-type": `${r.type}; charset=utf-8` });
    res.end(r.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("指示文を取りに行く道具は、鍵を外へ出さない", () => {
  it("うまくいったとき、標準出力は指示文だけで鍵は無い", async () => {
    respond = () => ({ status: 200, body: "# 指示文\n\n直してください。\n", type: "text/markdown" });
    const outcome = await runScript(["get", "improve_1"], { HGCC_BASE_URL: origin });

    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain("# 指示文");
    // 案内は標準エラーへ回っている (指示文に手順の話が混ざらない)
    expect(outcome.stdout).not.toContain("接続先");
    expect(outcome.stderr).toContain("接続先");
    expectNoLeak(outcome);
  });

  it("鍵はヘッダとしてだけサーバへ渡る", async () => {
    receivedAuth = null;
    respond = () => ({ status: 200, body: "# 指示文\n", type: "text/markdown" });
    await runScript(["get", "improve_1"], { HGCC_BASE_URL: origin });
    expect(receivedAuth).toBe(`Bearer ${TOKEN}`);
  });

  it("断られたときの文面にも鍵が出ない", async () => {
    respond = () => ({
      status: 401,
      body: "この鍵は期限が切れています。管理画面で新しく発行してください。",
      type: "text/plain",
    });
    const outcome = await runScript(["get", "improve_1"], { HGCC_BASE_URL: origin });

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("期限が切れています");
    expectNoLeak(outcome);
  });

  it("サーバの応答に鍵が混ざっていても、伏せてから出す", async () => {
    // 相手が誤って鍵を返してくる事故を想定する。こちらの出力で止められること。
    respond = () => ({ status: 200, body: `鍵は ${TOKEN} です\n`, type: "text/markdown" });
    const outcome = await runScript(["get", "improve_1"], { HGCC_BASE_URL: origin });

    expect(outcome.stdout).toContain("[鍵は伏せています]");
    expectNoLeak(outcome);
  });

  it("つながらないときも、鍵ではなく行き先だけを言う", async () => {
    const outcome = await runScript(["get", "improve_1"], {
      // 誰も待っていないポート
      HGCC_BASE_URL: "http://127.0.0.1:1",
    });
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("つながりませんでした");
    expectNoLeak(outcome);
  });

  it("使い方を間違えたときも鍵は出ない", async () => {
    const outcome = await runScript(["さっぱり分からない命令"], { HGCC_BASE_URL: origin });
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("使い方");
    expectNoLeak(outcome);
  });

  it("鍵が渡されていなければ、置き場所の案内だけを出して止まる", async () => {
    const outcome = await runScript(["list"], { HGCC_TOKEN: "", HGCC_BASE_URL: origin });
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("鍵が渡されていません");
    expectNoLeak(outcome);
  });
});

describe("つなぎ先の既定", () => {
  it("何も指定しなければ手元のアプリを見る（本番を既定にしない）", async () => {
    // localhost:8787 では誰も待っていないので、つながらない旨の文面に行き先が出る。
    const outcome = await runScript(["list"], {});
    expect(outcome.stderr).toContain("http://localhost:8787");
    expect(outcome.stderr).not.toContain("workers.dev");
    expectNoLeak(outcome);
  });

  it("どの鍵の取り出し元を使ったかを毎回知らせる", async () => {
    respond = () => ({ status: 200, body: "# 指示文\n", type: "text/markdown" });
    const outcome = await runScript(["get", "improve_1"], {
      HGCC_BASE_URL: origin,
      HGCC_SOURCE: "1Password",
    });
    expect(outcome.stderr).toContain("鍵の取り出し元: 1Password");
    expectNoLeak(outcome);
  });
});
