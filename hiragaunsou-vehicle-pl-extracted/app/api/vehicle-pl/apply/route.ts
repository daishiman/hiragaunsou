import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehiclePlOverrideRepository } from "../../../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import { D1AuditLogRepository } from "../../../../src/infrastructure/db/D1AuditLogRepository";
import { ApplyPendingOverridesUseCase } from "../../../../src/usecase/steps/applyPendingOverrides";
import { monthlyPlRecalculator } from "../../../_lib/monthlyPlRecalculator";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 溜まっている直しを収支表へまとめて反映する (再計算を1回だけ走らせる)。
 *
 * 収支表の画面では指摘を続けて直すため、1件ごとに再計算すると待ち時間が積み上がる。
 * 直しの保存は即時、反映はここでまとめて、という分け方にしてある。
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "input")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { yearMonth?: string } | null;
  if (!body?.yearMonth) {
    return NextResponse.json({ error: "yearMonth が必要です" }, { status: 400 });
  }

  const db = createDb(env.DB);
  try {
    const result = await new ApplyPendingOverridesUseCase(
      new D1VehiclePlOverrideRepository(db),
      monthlyPlRecalculator(db),
      new D1AuditLogRepository(db),
    ).execute({
      yearMonth: body.yearMonth,
      actorId: session!.id,
      actorName: session!.name,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "収支表への反映に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
