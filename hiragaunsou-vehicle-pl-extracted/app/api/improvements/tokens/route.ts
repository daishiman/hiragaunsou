import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../src/infrastructure/db/D1ImprovementRepository";
import { D1InstructionTokenRepository } from "../../../../src/infrastructure/db/D1InstructionTokenRepository";
import {
  ALL_SCOPE_AUDIT_ID,
  CI_TOKEN_AUDIT_ID,
  allScopeTokenRejection,
  CI_ABILITIES,
  tokenSetupNote,
  DEVELOPER_ABILITIES,
  generateAccessToken,
  maskToken,
  TOKEN_ALL_SCOPE_DEFAULT_DAYS,
  TOKEN_ALL_SCOPE_REASON_MIN,
  TOKEN_DEFAULT_DAYS,
  TOKEN_MAX_DAYS,
  tokenExpiresAt,
} from "../../../../src/domain/rules/instructionAccess";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 指示文を読むための鍵の発行と一覧。システム管理者だけ。
 *
 * 平文の鍵を返すのは、この POST の応答1回だけ。保存するのは指紋だけなので、
 * 後からもう一度見ることはできない (見られる仕組みにすると、DB を読める人が
 * 誰でも指示文を読めることになる)。
 */
export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_improvements") || !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { env } = await getCloudflareContext({ async: true });
  const tokens = new D1InstructionTokenRepository(createDb(env.DB));
  return NextResponse.json({ items: await tokens.list() });
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_improvements") || !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const body = raw as {
    name?: unknown;
    ids?: unknown;
    days?: unknown;
    reason?: unknown;
    purpose?: unknown;
  };
  /**
   * 何に使う鍵か。
   *   developer … 手元の開発者に渡す。読んで、読んだ件だけ状態を進められる
   *   ci        … GitHub Actions に置く。状態を進めることしかできない (指示文は読めない)
   *
   * 既定を developer にするのは、画面から押して作る鍵がこちらだから。
   * CI 用は年に数回しか作らないので、明示して作らせるほうが取り違えが起きにくい。
   */
  const purpose = body.purpose === "ci" ? "ci" : "developer";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  // 範囲が空なら「発行済みのすべてを読める鍵」。既定の期限も別に持つ。
  // CI 用の鍵は指示文を読めないので、範囲が空でもこの重みは掛からない
  // (読めない鍵に「全部読めることの重み」を課しても、手数が増えるだけで安全にならない)。
  const allScope = purpose === "developer" && ids.length === 0;
  const defaultDays = allScope ? TOKEN_ALL_SCOPE_DEFAULT_DAYS : TOKEN_DEFAULT_DAYS;
  const days =
    typeof body.days === "number" && Number.isFinite(body.days) ? body.days : defaultDays;

  if (allScope) {
    // 全件を読める鍵だけは、理由と短い期限をサーバ側で必ず確かめる。
    // 画面の作りに頼ると、API を直に叩けば重みを外せることになる。
    const rejection = allScopeTokenRejection({ reason, days });
    if (rejection) return NextResponse.json({ message: rejection }, { status: 400 });
  } else if (purpose === "ci" && reason.trim().length < TOKEN_ALL_SCOPE_REASON_MIN) {
    // CI 用の鍵は GitHub Secrets に置かれ、人の目に触れないまま期限まで動き続ける。
    // 「いつ・何のために作ったか」が記録に残らないと、消してよいのか判断できない。
    return NextResponse.json(
      { message: "この鍵は GitHub Actions に置いたままになります。何に使うかを書いてください。" },
      { status: 400 },
    );
  } else if (days < 1 || days > TOKEN_MAX_DAYS) {
    return NextResponse.json(
      { message: `鍵の有効期間は1日〜${TOKEN_MAX_DAYS}日で指定してください。` },
      { status: 400 },
    );
  }

  const db = createDb(env.DB);
  const repo = new D1ImprovementRepository(db);
  const tokens = new D1InstructionTokenRepository(db);

  // 範囲に入れた要望が実在するかを確かめる。存在しない id を範囲に入れた鍵は、
  // 「渡したはずなのに読めない」という分かりにくい失敗になる。
  if (ids.length > 0) {
    const found = await repo.findManyByIds(ids);
    const missing = ids.filter((id) => !found.some((f) => f.id === id));
    if (missing.length > 0) {
      return NextResponse.json(
        { message: `見つからない要望が${missing.length}件あります。選び直してください。` },
        { status: 400 },
      );
    }
  }

  const now = new Date();
  const expiresAt = tokenExpiresAt(now, days);
  const { token, hash } = await generateAccessToken();
  const id = `tok_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  await tokens.issue({
    id,
    name: name || defaultName(purpose, ids.length),
    tokenHash: hash,
    scopeIds: ids,
    abilities: purpose === "ci" ? CI_ABILITIES : DEVELOPER_ABILITIES,
    // 単一の会社しか扱っていないので null。マルチテナントにするときは
    // ここへセッションの会社IDを入れる (焼き込み先はこの1点)。
    companyId: null,
    createdById: session.id,
    createdByName: session.name ?? "管理者",
    expiresAt,
  });

  // 鍵を作ったこと自体も記録に残す。範囲に入れた要望それぞれに書く。
  // 全件を読める鍵は紐づけ先の要望が無いので、決まった名前で1行だけ残す
  // (一番強い鍵の記録だけが残らない、という穴を作らないため)。
  // CI 用の鍵も範囲を持たないので、ids から作ると1行も残らない。
  // 一番黙って動く鍵の記録が消えるので、こちらも決まった名前で1行残す。
  await repo.appendAudit(
    purpose === "ci"
      ? [
          {
            requestId: CI_TOKEN_AUDIT_ID,
            actorId: session.id,
            actorName: session.name ?? "管理者",
            action: "token_issue" as const,
            fromStatus: null,
            toStatus: null,
            reason: `GitHub Actions 用の鍵「${name || id}」を発行（状態の更新だけ。期限 ${expiresAt.toISOString()}）。理由: ${reason}`,
          },
        ]
      : allScope
      ? [
          {
            requestId: ALL_SCOPE_AUDIT_ID,
            actorId: session.id,
            actorName: session.name ?? "管理者",
            action: "token_issue" as const,
            fromStatus: null,
            toStatus: null,
            reason: `発行済みのすべてを読める鍵「${name || id}」を発行（期限 ${expiresAt.toISOString()}）。理由: ${reason}`,
          },
        ]
      : ids.map((requestId) => ({
          requestId,
          actorId: session.id,
          actorName: session.name ?? "管理者",
          action: "token_issue" as const,
          fromStatus: null,
          toStatus: null,
          reason: `鍵「${name || id}」を発行（期限 ${expiresAt.toISOString()}）`,
        })),
  );

  return NextResponse.json({
    id,
    // 平文はここでしか返さない。以後はこのマスクした形しか出さない。
    token,
    masked: maskToken(token),
    expiresAt,
    scopeIds: ids,
    purpose,
    // 開発者が 1Password へ預けるまでの案内。Claude に貼る文ではない
    // (貼ると鍵が会話の履歴に残り、取り消せない)。
    // CI 用の鍵は人が預けるものではないので、この案内は付けない。
    command: purpose === "ci" ? null : tokenSetupNote(env.BETTER_AUTH_URL, token),
  });
}

function defaultName(purpose: "developer" | "ci", scopeCount: number): string {
  if (purpose === "ci") return "GitHub Actions 用の鍵（状態の更新だけ）";
  return scopeCount > 0 ? `${scopeCount}件を渡すための鍵` : "全件を読める鍵";
}
