import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { masterChangeStack } from "../../../_lib/masterChangeStack";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";
import { MASTER_CHANGE_PERMISSION } from "../route";

/**
 * POST /api/master-changes/apply
 * 確定済みの月へ、いまのマスタの内容を反映する。
 *
 * yearMonths を複数渡せば「まとめて反映」になる。まとめてでも1月ずつ記録を残すので、
 * あとから月単位で取り消せる。1件でも失敗したらそこで止めて、成功した月だけを返す
 * (全部巻き戻すと、成功していた月まで理由なく元に戻る)。
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
    yearMonths?: unknown;
  } | null;

  const yearMonths = Array.isArray(body?.yearMonths)
    ? body.yearMonths.filter(
        (v): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v),
      )
    : [];
  if (yearMonths.length === 0) {
    return NextResponse.json({ error: "反映する月を選んでください" }, { status: 400 });
  }

  const db = createDb(env.DB);
  const actor = { id: session!.id, name: session!.name ?? "" };
  const stack = masterChangeStack(db, actor);

  const applied: { yearMonth: string; applyId: string; vehicleCount: number }[] = [];
  for (const yearMonth of yearMonths) {
    try {
      const { applyId, summary } = await stack.applyToConfirmed.execute({ yearMonth, actor });
      applied.push({ yearMonth, applyId, vehicleCount: summary.vehicleCount });
    } catch (e) {
      const message = e instanceof Error ? e.message : "反映に失敗しました";
      return NextResponse.json({ applied, error: `${yearMonth}: ${message}` }, { status: 400 });
    }
  }

  return NextResponse.json({ applied });
}
