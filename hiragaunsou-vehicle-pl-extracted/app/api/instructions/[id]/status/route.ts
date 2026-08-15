import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb } from "../../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../../src/infrastructure/db/D1ImprovementRepository";
import { D1InstructionTokenRepository } from "../../../../../src/infrastructure/db/D1InstructionTokenRepository";
import { authorizeToken } from "../../../../../src/usecase/improvements/readInstructions";
import { recordHandoffEvent } from "../../../../../src/usecase/improvements/recordHandoffEvent";
import { bearerTokenOf } from "../../../../../src/domain/rules/instructionAccess";
import { isHandoffEvent, parsePrReference } from "../../../../../src/domain/rules/instructionHandoff";

/**
 * 直したことを知らせる口。
 *
 * 叩くのは2者だけ。手元の開発者 (指示文を取得した鍵) と GitHub Actions
 * (状態を進めることしかできない鍵)。どちらも Cookie ではなく鍵で通す。
 *
 * 状態そのものではなく「何が起きたか」を受け取る形にしてある。
 *   pr_opened → レビュー待ち / pr_merged → 対応済み / pr_closed → 対応中へ戻す
 * 状態を直接指定させると、呼ぶ側の都合で飛び級ができてしまい、
 * 「PR も無いのに対応済み」という行が管理画面に並ぶ。
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const tokens = new D1InstructionTokenRepository(db);
  const repo = new D1ImprovementRepository(db);

  // read の力は求めない。CI 用の鍵は指示文を読めないまま、これだけを叩く。
  const auth = await authorizeToken(bearerTokenOf(request), tokens, new Date(), "none");
  if ("error" in auth) {
    return NextResponse.json({ message: auth.error }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const body = raw as { event?: unknown; prUrl?: unknown; prNumber?: unknown };
  if (typeof body.event !== "string" || !isHandoffEvent(body.event)) {
    return NextResponse.json(
      { message: "event には pr_opened / pr_merged / pr_closed のいずれかを送ってください。" },
      { status: 400 },
    );
  }
  if (body.event === "fetched") {
    // 取得は指示文を読んだときに自動で記録する。ここから申告させると、
    // 読んでいないのに「対応中」にできてしまう。
    return NextResponse.json(
      { message: "取得の記録は指示文を読んだときに自動で残ります。" },
      { status: 400 },
    );
  }

  const pr = parsePrReference(body.prUrl, body.prNumber);
  if (body.prUrl !== undefined && pr === null) {
    return NextResponse.json(
      { message: "確認依頼 (PR) の URL は https://github.com/…/pull/番号 の形で送ってください。" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await recordHandoffEvent(id, body.event, pr, auth.token, { repo, tokens });
  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: result.status });
  }
  return NextResponse.json(
    { id, status: result.status, message: result.message },
    { headers: { "cache-control": "no-store" } },
  );
}
