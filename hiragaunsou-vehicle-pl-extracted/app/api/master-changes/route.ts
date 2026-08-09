import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { masterChangeStack } from "../../_lib/masterChangeStack";

/**
 * マスタを触れる権限。率・車両・運転者のどれも収支表の土台なので、
 * 3つとも同じ「管理者だけ」に揃える。片方だけ緩いと、緩いほうから同じ数字が動かせてしまう。
 */
export const MASTER_CHANGE_PERMISSION = "manage_imports" as const;

/**
 * GET /api/master-changes
 * 据え置いている月の食い違い・直しの履歴・反映の記録をまとめて返す。
 *
 * 確定済みの月ぶんだけ作り直しの計算を回すので軽くはない。画面を開いたときにだけ呼ぶ。
 */
export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, MASTER_CHANGE_PERMISSION)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const stack = masterChangeStack(db, { id: session!.id, name: session!.name ?? "" });

  try {
    return NextResponse.json(await stack.status.execute());
  } catch (e) {
    const message = e instanceof Error ? e.message : "食い違いの確認に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
