import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../src/infrastructure/db/D1ImprovementRepository";
import { D1InstructionTokenRepository } from "../../../../src/infrastructure/db/D1InstructionTokenRepository";
import { buildInstructionDeps } from "../../../../src/usecase/improvements/instructionDeps";
import { authorizeToken, readInstructions } from "../../../../src/usecase/improvements/readInstructions";
import { bearerTokenOf } from "../../../../src/domain/rules/instructionAccess";

/**
 * Claude Code が指示文を1件だけ読みに来る口。
 *
 * 守り (鍵の期限・範囲・発行済みかどうか) は一括取得と同じ処理を使う。
 * 1件用に判定を書き直すと、片方にだけ入った確認がもう片方から抜ける。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "md";
  const deps = {
    ...buildInstructionDeps(env, repo, { id: "", name: `鍵: ${auth.token.name}` }),
    tokens,
  };
  const { items, skipped } = await readInstructions([id], auth.token, deps);

  const item = items[0];
  if (!item) {
    const reason = skipped[0]?.reason ?? "この指示文は読めません。";
    return format === "json"
      ? NextResponse.json({ message: reason }, { status: 404 })
      : new Response(reason, {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
  }

  if (format === "json") {
    return NextResponse.json({ ...item.structured, version: item.version, markdown: item.markdown });
  }
  return new Response(`${item.markdown}\n`, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
