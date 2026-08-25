import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../src/infrastructure/db/D1ImprovementRepository";
import { buildInstructionDeps } from "../../../../src/usecase/improvements/instructionDeps";
import { publishInstructions } from "../../../../src/usecase/improvements/publishInstructions";
import { PUBLISH_BULK_MAX } from "../../../../src/domain/rules/improvementLifecycle";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 選んだ改善要望の指示文を、まとめて発行する。
 *
 * dryRun を付けると、何が起きるか (新しく発行 / 内容を更新 / 何もしない / 対象外) と
 * 下書きの全文だけを返し、保存は一切しない。押す前に外へ出る中身を読ませるための口。
 *
 * 1件だけの発行も /api/improvements/[id]/instruction から同じ処理を呼ぶ。
 * 入口ごとに処理を書くと、片方にだけ入った守りがもう片方から抜ける。
 */
export async function POST(request: Request) {
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
  const body = raw as { ids?: unknown; dryRun?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ message: "対象が選ばれていません。" }, { status: 400 });
  }
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ message: "同じ要望が重複して選ばれています。" }, { status: 400 });
  }
  // 黙って切り捨てない。切り捨てると、渡したつもりの件が渡っていないことに気づけない。
  if (ids.length > PUBLISH_BULK_MAX) {
    return NextResponse.json(
      {
        message: `一度に渡せるのは${PUBLISH_BULK_MAX}件までです（いま${ids.length}件が選ばれています）。分けて実行してください。`,
      },
      { status: 400 },
    );
  }

  const repo = new D1ImprovementRepository(createDb(env.DB));
  const deps = buildInstructionDeps(env, repo, {
    id: session.id,
    name: session.name ?? "管理者",
  });
  const report = await publishInstructions(ids, deps, { dryRun: body.dryRun === true });
  return NextResponse.json(report);
}
