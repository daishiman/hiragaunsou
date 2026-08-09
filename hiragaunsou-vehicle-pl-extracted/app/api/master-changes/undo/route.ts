import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { masterChangeStack } from "../../../_lib/masterChangeStack";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";
import { MASTER_CHANGE_PERMISSION } from "../route";

/**
 * POST /api/master-changes/undo
 * 元に戻す。2種類あるが、どちらも「1つ前の状態に戻す」操作として同じ入口にする。
 *
 *   editId  … マスタの直しそのものを取り消す (直す前の値に戻す)
 *   applyId … 確定済み月への反映を取り消す (その月を反映前の収支表に戻す)
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, MASTER_CHANGE_PERMISSION)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    editId?: unknown;
    applyId?: unknown;
  } | null;

  const db = createDb(env.DB);
  const actor = { id: session!.id, name: session!.name ?? "" };
  const stack = masterChangeStack(db, actor);

  try {
    if (typeof body?.applyId === "string" && body.applyId !== "") {
      const result = await stack.revert.execute({ applyId: body.applyId, actor });
      return NextResponse.json({ kind: "apply", ...result });
    }
    if (typeof body?.editId === "string" && body.editId !== "") {
      const result = await stack.undo.execute({ editId: body.editId, actor });
      return NextResponse.json({
        kind: "edit",
        targetLabel: result.record.targetLabel,
        fieldLabel: result.record.fieldLabel,
        restoredValue: result.record.beforeValue,
        applied: result.result.appliedYearMonths,
        heldBack: result.result.heldBackYearMonths,
      });
    }
    return NextResponse.json({ error: "戻す対象が指定されていません" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "元に戻せませんでした";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
