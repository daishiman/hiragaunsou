import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../../src/infrastructure/db/D1ImprovementRepository";
import { buildInstructionDeps } from "../../../../../src/usecase/improvements/instructionDeps";
import { publishInstructions } from "../../../../../src/usecase/improvements/publishInstructions";
import { isSameOriginRequest } from "../../../../_lib/assertSameOrigin";

/**
 * 1件の要望の指示文を発行する (詳細画面から)。
 *
 * 中身は一括発行と同じ処理を、件数1で呼ぶだけ。二重発行の防止も対象外の除外も
 * そちらに入っているので、こちらで書き足すことは無い。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_improvements") || !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const dryRun = (raw as { dryRun?: unknown }).dryRun === true;

  const { id } = await params;
  const repo = new D1ImprovementRepository(createDb(env.DB));
  const deps = buildInstructionDeps(env, repo, {
    id: session.id,
    name: session.name ?? "管理者",
  });
  const report = await publishInstructions([id], deps, { dryRun });

  if (report.plan.items.length === 0) {
    return NextResponse.json({ message: "対象の要望が見つかりませんでした。" }, { status: 404 });
  }
  return NextResponse.json(report);
}
