import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../../src/infrastructure/db/D1ImportBatchRepository";
import { D1VehiclePlRepository } from "../../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1AuditLogRepository } from "../../../../src/infrastructure/db/D1AuditLogRepository";
import {
  DeleteMonthlyPlUseCase,
  ListMonthlyPlDeletionLogUseCase,
  ListMonthsWithoutImportsUseCase,
} from "../../../../src/usecase/steps/manageMonthlyPlData";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";
import { isYearMonth } from "../../../_lib/yearMonth";

/**
 * 取込が1件も無いのに収支表だけが残っている月の確認と削除
 * (/admin/import-batches 画面のバックエンド、manage_imports 権限=admin専用)。
 *
 * 消せる対象を「取込が無い月」に絞る判断はユースケース側にある。ここは権限・同一オリジン・
 * 入力形式だけを見て、業務上の可否は持たない。
 */
export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_imports")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const months = await new ListMonthsWithoutImportsUseCase(
    new D1VehiclePlRepository(db),
    new D1ImportBatchRepository(db),
  ).execute();
  // 消した直後に履歴も一緒に取り直せるよう、一覧と履歴を同じ応答で返す。
  const deletionLog = await new ListMonthlyPlDeletionLogUseCase(
    new D1AuditLogRepository(db),
  ).execute();
  return NextResponse.json({ months, deletionLog });
}

export async function DELETE(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_imports")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const yearMonth = new URL(request.url).searchParams.get("ym") ?? undefined;
  if (!isYearMonth(yearMonth)) {
    return NextResponse.json({ error: "対象の年月が指定されていません" }, { status: 400 });
  }

  const db = createDb(env.DB);
  try {
    const result = await new DeleteMonthlyPlUseCase(
      new D1VehiclePlRepository(db),
      new D1ImportBatchRepository(db),
      new D1AuditLogRepository(db),
    ).execute({ actorId: session!.id, actorName: session!.name, yearMonth });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "収支表の削除に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
