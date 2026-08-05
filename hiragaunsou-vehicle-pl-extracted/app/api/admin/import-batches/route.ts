import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../../src/infrastructure/db/D1ImportBatchRepository";
import { D1AuditLogRepository } from "../../../../src/infrastructure/db/D1AuditLogRepository";
import {
  DeleteImportBatchUseCase,
  ListImportBatchDeletionLogUseCase,
  ListImportBatchesUseCase,
} from "../../../../src/usecase/steps/manageImportBatches";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 管理者による全期間・全帳票種別の取込バッチ管理 (/admin/import-batches 画面のバックエンド、
 * manage_imports 権限=admin専用)。
 *
 * 過去に「別の月のサンプルデータが誤って本番へ取り込まれた」実インシデントが発生し、
 * 復旧は開発者がD1へ直接SQLを打って対応した。同じ状況を管理者自身がUIから発見・削除できるように
 * するための画面。削除は取消不可のため、確認ダイアログと監査ログ記録を必須にする。
 */
export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_imports")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const batches = await new ListImportBatchesUseCase(new D1ImportBatchRepository(db)).execute();
  const deletionLog = await new ListImportBatchDeletionLogUseCase(new D1AuditLogRepository(db)).execute();
  return NextResponse.json({ batches, deletionLog });
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

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const db = createDb(env.DB);
    await new DeleteImportBatchUseCase(
      new D1ImportBatchRepository(db),
      new D1AuditLogRepository(db),
    ).execute({
      actorId: session!.id,
      actorName: session!.name,
      batchId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "削除に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
