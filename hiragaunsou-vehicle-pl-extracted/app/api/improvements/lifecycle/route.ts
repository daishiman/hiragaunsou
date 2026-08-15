import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../src/infrastructure/db/D1ImprovementRepository";
import { applyLifecycle } from "../../../../src/usecase/improvements/applyLifecycle";
import { D1InstructionTokenRepository } from "../../../../src/infrastructure/db/D1InstructionTokenRepository";
import {
  isLifecycleAction,
  lifecycleRequestError,
} from "../../../../src/domain/rules/improvementLifecycle";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 改善要望の状態を変える・廃棄する・廃棄から戻す (1件でも一括でも同じ口)。
 *
 * 完全削除はここでは受け付けない (/api/improvements/purge)。戻せる操作と
 * 戻せない操作を同じ入口に置くと、権限の確認をどこかで1つ書き忘れたときに
 * 「消せてはいけない人が消せる」side に倒れる。入口ごと分けておく。
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
  const body = raw as {
    action?: unknown;
    ids?: unknown;
    reason?: unknown;
    duplicateOfId?: unknown;
    dryRun?: unknown;
  };

  const action = typeof body.action === "string" ? body.action : "";
  if (!isLifecycleAction(action)) {
    return NextResponse.json({ message: "操作の指定が正しくありません。" }, { status: 400 });
  }
  if (action === "purge") {
    return NextResponse.json(
      { message: "完全削除はこの操作からは実行できません。" },
      { status: 400 },
    );
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const duplicateOfId = typeof body.duplicateOfId === "string" ? body.duplicateOfId : null;

  const error = lifecycleRequestError({ action, ids, reason, duplicateOfId });
  if (error) return NextResponse.json({ message: error }, { status: 400 });

  const db = createDb(env.DB);
  const repo = new D1ImprovementRepository(db);
  const tokens = new D1InstructionTokenRepository(db);
  const report = await applyLifecycle(
    {
      action,
      ids,
      reason: reason.length > 0 ? reason : null,
      duplicateOfId,
      dryRun: body.dryRun === true,
    },
    { repo, tokens, actorId: session.id, actorName: session.name ?? "管理者" },
  );

  return NextResponse.json(report);
}
