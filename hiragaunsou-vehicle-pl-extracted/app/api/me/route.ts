import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1UserRepository } from "../../../src/infrastructure/db/D1UserRepository";
import { UpdateOwnProfileUseCase } from "../../../src/usecase/steps/manageUsers";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";

/** ログイン中ユーザー情報 (S1等のUIがロール表示に使う) */
export async function GET() {
  const user = await getServerSession();
  return NextResponse.json({ user });
}

/**
 * 自分のプロフィール(氏名)を編集する (/profile 画面のバックエンド)。
 * メールアドレス・ロールは本人からは変更できない(ロールは管理者が /admin/users から変更する)。
 */
export async function PATCH(request: Request) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  if (!body?.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const db = createDb(env.DB);
    await new UpdateOwnProfileUseCase(new D1UserRepository(db)).execute(session.id, body.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "更新に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
