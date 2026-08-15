import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../../src/infrastructure/db/D1ImprovementRepository";
import { D1InstructionTokenRepository } from "../../../../../src/infrastructure/db/D1InstructionTokenRepository";
import { isSameOriginRequest } from "../../../../_lib/assertSameOrigin";

/**
 * 鍵を失効させる。
 *
 * 鍵は消さずに「失効した」と印を付ける。消してしまうと、その鍵で何が読まれたかを
 * 後から数えられなくなる。漏れたかもしれない鍵ほど、記録が要る。
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const reason = typeof (raw as { reason?: unknown }).reason === "string"
    ? ((raw as { reason: string }).reason.trim() || "管理画面から失効")
    : "管理画面から失効";

  const { id } = await params;
  const db = createDb(env.DB);
  const tokens = new D1InstructionTokenRepository(db);
  const repo = new D1ImprovementRepository(db);

  const target = await tokens.list().then((list) => list.find((t) => t.id === id) ?? null);
  if (!target) {
    return NextResponse.json({ message: "対象の鍵が見つかりませんでした。" }, { status: 404 });
  }

  const revoked = await tokens.revoke(id, `${reason}（${session.name ?? "管理者"}）`);
  if (!revoked) {
    return NextResponse.json({ ok: true, message: "この鍵はすでに失効しています。" });
  }

  if (target.scopeIds.length > 0) {
    await repo.appendAudit(
      target.scopeIds.map((requestId) => ({
        requestId,
        actorId: session.id,
        actorName: session.name ?? "管理者",
        action: "token_revoke" as const,
        fromStatus: null,
        toStatus: null,
        reason: `鍵「${target.name || id}」を失効: ${reason}`,
      })),
    );
  }

  return NextResponse.json({ ok: true, message: "鍵を失効しました。以後この鍵では読めません。" });
}
