import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1InvitationRepository } from "../../../../src/infrastructure/db/D1InvitationRepository";
import { D1UserRepository } from "../../../../src/infrastructure/db/D1UserRepository";
import {
  CreateInvitationUseCase,
  ListInvitationsUseCase,
  RevokeInvitationUseCase,
} from "../../../../src/usecase/steps/manageInvitations";
import { isRole } from "../../../../src/usecase/steps/manageUsers";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";
import { createAuth, type AuthEnv } from "../../../../src/infrastructure/auth/auth";

/**
 * 管理者によるユーザー招待(仮登録)管理 (/admin/users 画面のバックエンド、manage_users 権限のみ)。
 *
 * authMethod="google": 「このメールで初めてGoogleサインインしたらこのロールを付与する」という
 * 予約のみ。user行はDBへ直接INSERTしない(auth.ts の user.create.before フックが本人の初回
 * サインイン時に招待からロールを引き継ぐ)。
 *
 * authMethod="password": Gmailを持たない社内ユーザー向け。メール送信基盤を持たないため、
 * 管理者がこの画面で直接入力した初期パスワード(initialPassword)を使い、better-authの
 * internalInviteProvisioning経由のsignUpEmailでその場でuser+credential行を作成する。
 * 発行したパスワードはレスポンスに含めない(画面側で管理者が入力した値をそのまま表示・案内する)。
 * 管理者は発行後、そのメールアドレス・初期パスワードを社内チャット等の別経路で本人へ伝える。
 */
export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_users")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const invitations = await new ListInvitationsUseCase(new D1InvitationRepository(db)).execute();
  return NextResponse.json({ invitations });
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_users")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    role?: string;
    authMethod?: string;
    initialPassword?: string;
  } | null;

  if (!body?.email || typeof body.email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (!isRole(body.role)) {
    return NextResponse.json({ error: "role is invalid" }, { status: 400 });
  }
  const authMethod = body.authMethod === "password" ? "password" : "google";

  if (authMethod === "password") {
    if (!body.initialPassword || typeof body.initialPassword !== "string" || body.initialPassword.length < 8) {
      return NextResponse.json({ error: "初期パスワードは8文字以上で入力してください" }, { status: 400 });
    }
  }

  const email = body.email.trim().toLowerCase();

  try {
    const db = createDb(env.DB);
    const result = await new CreateInvitationUseCase(
      new D1InvitationRepository(db),
      new D1UserRepository(db),
    ).execute({
      invitedBy: session!.id,
      email,
      role: body.role,
      authMethod,
      initialPassword: authMethod === "password" ? body.initialPassword : undefined,
    });

    if (authMethod !== "password") {
      return NextResponse.json({ ok: true });
    }

    // ここから先はメール/パスワード招待専用: 管理者が指定した初期パスワードで
    // その場でアカウント(user+credential)を作成する。メール送信は一切行わない。
    if (result.needsAccountProvisioning) {
      const provisioningAuth = createAuth(env as unknown as AuthEnv, {
        internalInviteProvisioning: { email, role: body.role },
      });
      await provisioningAuth.api.signUpEmail({
        body: { email, password: body.initialPassword!, name: email.split("@")[0] ?? email },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "招待の作成に失敗しました";
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

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = createDb(env.DB);
  await new RevokeInvitationUseCase(new D1InvitationRepository(db)).execute(id);
  return NextResponse.json({ ok: true });
}
