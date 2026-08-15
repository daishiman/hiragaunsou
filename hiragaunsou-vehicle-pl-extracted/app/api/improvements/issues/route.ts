import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../src/infrastructure/db/D1ImprovementRepository";
import { syncIssues } from "../../../../src/usecase/improvements/syncIssues";
import { buildIssueSyncDeps } from "../../../../src/usecase/improvements/issueSyncDeps";
import { ISSUE_BULK_MAX } from "../../../../src/domain/rules/improvementLifecycle";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 選んだ改善要望をまとめて GitHub Issue へ送る (管理者の操作からしか動かない)。
 *
 * 実行の前に必ず dryRun を通せるようにする。何件が新しく立ち、何件が更新され、
 * 何件は何もしないのかを見てから押せないと、一括は怖くて使えない。
 *
 * 1件ずつの送信 (/api/improvements/[id]/issue) と同じ syncIssues を通す。
 * 通す処理が同じなので、どちらから送っても二重起票の防止と空更新の抑止が効く。
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
  const body = raw as { ids?: unknown; dryRun?: unknown; reopenClosed?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ message: "対象が選ばれていません。" }, { status: 400 });
  }
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ message: "同じ要望が重複して選ばれています。" }, { status: 400 });
  }
  // 上限を超えた分を黙って切り捨てない。切り捨てると、送ったつもりの件が
  // 届いていないことに誰も気づけない。
  if (ids.length > ISSUE_BULK_MAX) {
    return NextResponse.json(
      {
        message: `一度に送れるのは${ISSUE_BULK_MAX}件までです（いま${ids.length}件が選ばれています）。分けて送ってください。`,
      },
      { status: 400 },
    );
  }

  const repo = new D1ImprovementRepository(createDb(env.DB));
  const deps = buildIssueSyncDeps(env, repo, { id: session.id, name: session.name ?? "管理者" });
  const report = await syncIssues(ids, deps, {
    dryRun: body.dryRun === true,
    reopenClosed: body.reopenClosed === true,
  });

  const missing = ids.length - report.plan.items.length;
  return NextResponse.json({
    dryRun: body.dryRun === true,
    configured: report.configured,
    counts: {
      create: report.plan.create,
      update: report.plan.update,
      skip: report.plan.skip,
      excluded: report.plan.excluded,
      // 選んだ後に誰かが消した件。数だけは必ず出す (黙って減らさない)。
      missing,
    },
    items: report.plan.items,
    drafts: report.drafts,
    results: report.results,
  });
}
