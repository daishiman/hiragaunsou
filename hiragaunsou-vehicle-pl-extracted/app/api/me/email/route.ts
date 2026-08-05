import { NextResponse } from "next/server";
import { eq, and, ne } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createAuth, type AuthEnv } from "../../../../src/infrastructure/auth/auth";
import { createDb } from "../../../../src/infrastructure/db/client";
import { user, account, session as sessionTable } from "../../../../src/infrastructure/db/auth-schema";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ログイン中ユーザーによる自分のメールアドレス変更(/profile 画面のバックエンド)。
 *
 * 確認メール送信は行わない(メール送信基盤を持たない方針のため)。その代わり、本人確認として
 * 現在のパスワードの再入力を必須にし、変更は即座に反映する。変更後は、他デバイス/他タブの
 * セッションを全て失効させ、今のセッションだけを有効に保つ(乗っ取り対策)。
 *
 * メール/パスワード資格情報(credential account)を持つユーザーのみが対象。
 * Googleサインインのみのユーザーは、アプリ内のメールアドレスが実際のGoogleアカウントの識別に
 * 使われるため、この画面からの変更は許可しない(整合性が崩れるため)。
 */
export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const auth = createAuth(env as unknown as AuthEnv);
  const activeSession = await auth.api.getSession({ headers: request.headers });
  if (!activeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const currentSession = {
    id: activeSession.user.id,
    email: activeSession.user.email,
    token: activeSession.session.token,
  };

  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { currentPassword?: string; newEmail?: string }
    | null;
  const currentPassword = body?.currentPassword;
  const newEmail = body?.newEmail?.trim().toLowerCase();

  if (!currentPassword || typeof currentPassword !== "string") {
    return NextResponse.json({ error: "現在のパスワードを入力してください" }, { status: 400 });
  }
  if (!newEmail || !EMAIL_PATTERN.test(newEmail)) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }

  const db = createDb(env.DB);

  const credentialRows = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, currentSession.id), eq(account.providerId, "credential")))
    .limit(1);
  if (credentialRows.length === 0) {
    return NextResponse.json(
      { error: "メール/パスワードでサインインしているアカウントのみ変更できます" },
      { status: 400 },
    );
  }

  // 本人確認: 現在のパスワードで実際にサインインできることを、better-auth標準の
  // signInEmail(パスワード照合)で検証する(独自のハッシュ比較は実装しない)。
  const verifyResult = await auth.api.signInEmail({
    body: { email: currentSession.email, password: currentPassword },
    asResponse: true,
  });
  if (!verifyResult.ok) {
    return NextResponse.json({ error: "現在のパスワードが正しくありません" }, { status: 400 });
  }

  if (newEmail !== currentSession.email.toLowerCase()) {
    const existing = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.email, newEmail), ne(user.id, currentSession.id)))
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ error: "このメールアドレスは既に使用されています" }, { status: 400 });
    }
  }

  await db.update(user).set({ email: newEmail }).where(eq(user.id, currentSession.id));

  // 乗っ取り対策: 今回のリクエストを発行した現在のセッション以外を全て失効させる。
  // (verifyResultのsignInEmail呼び出しで新たに作られたセッションも含めて破棄する)
  await db
    .delete(sessionTable)
    .where(and(eq(sessionTable.userId, currentSession.id), ne(sessionTable.token, currentSession.token)));

  return NextResponse.json({ ok: true, email: newEmail });
}
