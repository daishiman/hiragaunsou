import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../src/infrastructure/db/D1ImprovementRepository";
import { applyLifecycle } from "../../../../src/usecase/improvements/applyLifecycle";
import { buildIssueSyncDeps } from "../../../../src/usecase/improvements/issueSyncDeps";
import { lifecycleRequestError } from "../../../../src/domain/rules/improvementLifecycle";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 改善要望を完全に削除する (本文・画面の写し・診断情報ごと)。戻せない。
 *
 * 普段の「削除」は廃棄 (/api/improvements/lifecycle の archive) で、こちらは別物。
 * 個人情報を消してほしいという求めに応えるための口なので、消し残しを作らない。
 *
 * 守っているもの:
 *   - purge_improvements を持つ人だけ (manage_improvements では実行できない)
 *   - 画面で数えた件数 (confirmCount) と実際の件数が一致しなければ実行しない
 *   - 誰が・いつ・何を・なぜ消したかを監査に残す (監査自体は削除の対象に入れない)
 *   - すでに立っている Issue は消さず、「元データは削除済み」と書き残す
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "purge_improvements") || !session) {
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
  const body = raw as {
    ids?: unknown;
    reason?: unknown;
    confirmCount?: unknown;
    dryRun?: unknown;
  };

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const dryRun = body.dryRun === true;

  const error = lifecycleRequestError({
    action: "purge",
    ids,
    reason,
    // 下見 (dryRun) の時点では画面がまだ件数を確定していないので、件数の一致は本番だけ見る。
    confirmCount: dryRun ? ids.length : typeof body.confirmCount === "number" ? body.confirmCount : null,
  });
  if (error) return NextResponse.json({ message: error }, { status: 400 });

  const repo = new D1ImprovementRepository(createDb(env.DB));
  const deps = buildIssueSyncDeps(env, repo, { id: session.id, name: session.name ?? "管理者" });
  const report = await applyLifecycle(
    { action: "purge", ids, reason: reason.length > 0 ? reason : null, duplicateOfId: null, dryRun },
    { repo, client: deps.client, actorId: session.id, actorName: session.name ?? "管理者" },
  );

  return NextResponse.json(report);
}
