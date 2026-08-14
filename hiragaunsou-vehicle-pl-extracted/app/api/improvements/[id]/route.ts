import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../src/infrastructure/db/D1ImprovementRepository";
import {
  IMPROVEMENT_NOTE_MAX,
  improvementHandlingError,
  isImprovementStatus,
} from "../../../../src/domain/rules/improvement";
import {
  readJsonBodyWithinLimit,
  RequestBodyTooLargeError,
} from "../../../../src/infrastructure/security/readJsonBodyWithinLimit";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 要望の対応状況を変える。管理者だけ。
 *
 * 「対応済み」「見送り」で終わりにはしない (取り違えて閉じたときに戻せないと、
 * 要望そのものが消えたのと同じになる)。見送りだけは理由を必須にする。
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    raw = await readJsonBodyWithinLimit(request, 16_000);
  } catch (e) {
    if (e instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ message: "対応メモが長すぎます。" }, { status: 413 });
    }
    return NextResponse.json({ message: "送信内容の形式を確認してください。" }, { status: 400 });
  }

  const input = raw as { status?: unknown; note?: unknown };
  if (typeof input.status !== "string" || !isImprovementStatus(input.status)) {
    return NextResponse.json({ message: "対応状態を選んでください。" }, { status: 400 });
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    return NextResponse.json({ message: "送信内容の形式を確認してください。" }, { status: 400 });
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > IMPROVEMENT_NOTE_MAX) {
    return NextResponse.json(
      { message: `対応メモは${IMPROVEMENT_NOTE_MAX}文字までで入力してください。` },
      { status: 400 },
    );
  }

  const { id } = await params;
  const repo = new D1ImprovementRepository(createDb(env.DB));
  const current = await repo.findById(id);
  if (!current) {
    return NextResponse.json({ message: "対象の要望が見つかりませんでした。" }, { status: 404 });
  }

  const ruleError = improvementHandlingError(
    current.status,
    current.handledNote,
    input.status,
    note || null,
  );
  if (ruleError) return NextResponse.json({ message: ruleError }, { status: 400 });

  await repo.updateHandling(id, {
    status: input.status,
    // 空にしたときは「メモ無し」に戻す。消せないと、書き間違えた内容が残り続ける。
    note: note || null,
    handledById: session.id,
  });

  return NextResponse.json({ ok: true, message: "対応状況を更新しました。" });
}
