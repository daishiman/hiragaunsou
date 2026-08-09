import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { rebuildMonthlyPlAfterImport } from "../../../_lib/monthlyPlRecalculator";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";
import { isYearMonth } from "../../../_lib/yearMonth";

/**
 * 指定した月の収支表を、いまの取込内容とマスタから作り直す。
 *
 * 取込の直後には自動で作られる(app/api/import/[sourceType]/route.ts)。ここが要るのは、
 * 自動で作られる前に取り込んだ月・車両マスタが空のまま取り込んだ月など、
 * 「取込はあるのに収支表が1行も無い」状態が残っている場合。以前は取込をやり直す以外に
 * 手が無く、月次収支表の空の画面から先へ進めなかった。
 *
 * 作り直しの中身(材料集め・確定済み月の据え置き)は取込後と同じものを使う。
 * ここで別の組み立てを書くと、片方だけ古くなって月によって数字が変わる。
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

  const body = (await request.json().catch(() => null)) as { yearMonth?: unknown } | null;
  const yearMonth = typeof body?.yearMonth === "string" ? body.yearMonth : undefined;
  if (!isYearMonth(yearMonth)) {
    return NextResponse.json({ error: "yearMonth が必要です" }, { status: 400 });
  }

  const result = await rebuildMonthlyPlAfterImport(createDb(env.DB), yearMonth);
  return NextResponse.json({ yearMonth, ...result });
}
