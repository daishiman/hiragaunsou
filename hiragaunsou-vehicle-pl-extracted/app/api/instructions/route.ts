import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../src/infrastructure/db/D1ImprovementRepository";
import { D1InstructionTokenRepository } from "../../../src/infrastructure/db/D1InstructionTokenRepository";
import { buildInstructionDeps } from "../../../src/usecase/improvements/instructionDeps";
import {
  authorizeToken,
  combineMarkdown,
  readInstructions,
} from "../../../src/usecase/improvements/readInstructions";
import { bearerTokenOf } from "../../../src/domain/rules/instructionAccess";

/**
 * Claude Code が指示文を読みに来る口 (複数件まとめて)。
 *
 * ログインの Cookie ではなく鍵 (Authorization: Bearer) で通す。読みに来るのは人ではなく
 * 端末の道具なので、ブラウザのログインを前提にできない。そのぶん鍵は
 * 「範囲つき・期限つき・いつでも失効できる」ものにしてある。
 *
 * 既定は Markdown。そのまま Claude Code に読ませて作業に入れる形で返す。
 * `?format=json` を付けると構造化データを返す (将来の自動化のため)。
 *
 * 無認証では1件も読めない。鍵が無い・切れている・範囲外はすべて断る。
 */
export async function GET(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const tokens = new D1InstructionTokenRepository(db);
  const repo = new D1ImprovementRepository(db);

  const auth = await authorizeToken(bearerTokenOf(request), tokens);
  if ("error" in auth) {
    return new Response(auth.error, {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "json" ? "json" : "md";
  const requested = url.searchParams
    .getAll("id")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  // id の指定が無ければ、鍵の範囲をそのまま読む。管理画面で「まとめて渡す」を
  // 押した鍵は、その回に選んだ件だけを範囲に持っている。
  const ids = requested.length > 0 ? requested : auth.token.scopeIds;
  if (ids.length === 0) {
    const message =
      "この鍵は全件を読める鍵です。読みたい要望の id を ?id=... で指定してください。";
    return format === "json"
      ? NextResponse.json({ message }, { status: 400 })
      : new Response(message, {
          status: 400,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
  }

  const deps = {
    ...buildInstructionDeps(env, repo, { id: "", name: `鍵: ${auth.token.name}` }),
    tokens,
  };
  const { items, skipped } = await readInstructions(ids, auth.token, deps);

  if (format === "json") {
    return NextResponse.json({
      items: items.map((i) => ({ ...i.structured, version: i.version, markdown: i.markdown })),
      skipped,
    });
  }

  const notes =
    skipped.length > 0
      ? `\n\n---\n\n渡せなかったもの:\n${skipped.map((s) => `- ${s.id}: ${s.reason}`).join("\n")}`
      : "";
  return new Response(`${combineMarkdown(items)}${notes}\n`, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      // 鍵で読む内容なので、どこにも溜めさせない。
      "cache-control": "no-store",
    },
  });
}
