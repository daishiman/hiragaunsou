import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1UserRepository } from "../../../../src/infrastructure/db/D1UserRepository";
import {
  DeleteUserByAdminUseCase,
  ListUsersUseCase,
  UpdateUserByAdminUseCase,
  isRole,
} from "../../../../src/usecase/steps/manageUsers";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 管理者による全ユーザー管理 (/admin/users 画面のバックエンド、manage_users 権限のみ)。
 * ロール変更・アカウント凍結(banned)を行う。凍結すると対象ユーザーの全セッションを即座に失効させる。
 */
export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_users")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const users = await new ListUsersUseCase(new D1UserRepository(db)).execute();
  return NextResponse.json({ users });
}

export async function PATCH(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_users")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    role?: string;
    banned?: boolean;
  } | null;

  if (!body?.userId || typeof body.userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (body.role !== undefined && !isRole(body.role)) {
    return NextResponse.json({ error: "role is invalid" }, { status: 400 });
  }
  if (body.banned !== undefined && typeof body.banned !== "boolean") {
    return NextResponse.json({ error: "banned is invalid" }, { status: 400 });
  }

  try {
    const db = createDb(env.DB);
    await new UpdateUserByAdminUseCase(new D1UserRepository(db)).execute({
      actorId: session!.id,
      targetUserId: body.userId,
      role: body.role,
      banned: body.banned,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "更新に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_users")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const db = createDb(env.DB);
    await new DeleteUserByAdminUseCase(new D1UserRepository(db)).execute({
      actorId: session!.id,
      targetUserId: userId,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "削除に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
