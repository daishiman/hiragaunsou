import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../src/infrastructure/db/D1ImprovementRepository";
import { D1InstructionTokenRepository } from "../../../../src/infrastructure/db/D1InstructionTokenRepository";
import {
  ALL_SCOPE_AUDIT_ID,
  allScopeTokenRejection,
  claudeCodeCommand,
  generateAccessToken,
  maskToken,
  TOKEN_ALL_SCOPE_DEFAULT_DAYS,
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
  const body = raw as { name?: unknown; ids?: unknown; days?: unknown; reason?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  // 範囲が空なら「発行済みのすべてを読める鍵」。既定の期限も別に持つ。
  const allScope = ids.length === 0;
  const defaultDays = allScope ? TOKEN_ALL_SCOPE_DEFAULT_DAYS : TOKEN_DEFAULT_DAYS;
  const days =
    typeof body.days === "number" && Number.isFinite(body.days) ? body.days : defaultDays;

  if (allScope) {
    // 全件を読める鍵だけは、理由と短い期限をサーバ側で必ず確かめる。
    // 画面の作りに頼ると、API を直に叩けば重みを外せることになる。
    const rejection = allScopeTokenRejection({ reason, days });
    if (rejection) return NextResponse.json({ message: rejection }, { status: 400 });
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
    name: name || (ids.length > 0 ? `${ids.length}件を渡すための鍵` : "全件を読める鍵"),
    tokenHash: hash,
    scopeIds: ids,
    createdById: session.id,
    createdByName: session.name ?? "管理者",
    expiresAt,
  });

  // 鍵を作ったこと自体も記録に残す。範囲に入れた要望それぞれに書く。
  // 全件を読める鍵は紐づけ先の要望が無いので、決まった名前で1行だけ残す
  // (一番強い鍵の記録だけが残らない、という穴を作らないため)。
  await repo.appendAudit(
    allScope
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
    // そのままコピーして Claude Code に貼れる形。組み立てを画面側でやらせない
    // (URL の作り方を画面とサーバの2箇所に持つと、片方だけ古くなる)。
    command: claudeCodeCommand(env.BETTER_AUTH_URL, token),
  });
}
