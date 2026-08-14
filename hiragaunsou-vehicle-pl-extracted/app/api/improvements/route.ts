import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../src/infrastructure/db/D1ImprovementRepository";
import {
  IMPROVEMENT_BODY_MAX,
  IMPROVEMENT_REQUEST_MAX_BYTES,
  isAcceptableShot,
  normalizeImprovementBody,
  shotBytesOf,
} from "../../../src/domain/rules/improvement";
import {
  consumeRateLimit,
  IMPROVEMENT_SUBMIT_RATE_LIMIT,
} from "../../../src/infrastructure/security/rateLimit";
import {
  readJsonBodyWithinLimit,
  RequestBodyTooLargeError,
} from "../../../src/infrastructure/security/readJsonBodyWithinLimit";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";
import { isAcceptableScreenPath, routeIdentityOf } from "../../_lib/routeIdentity";

/**
 * 改善要望の受け口。
 *
 * ・どの画面から届いたかは URL から引き当てる (送信側の名乗りは使わない)
 * ・投稿者は必ずセッションから決める (本文の指定は受け付けない)
 * ・画像は形式と大きさをここでも確かめる (ブラウザ側の縮小に頼らない)
 * ・同じ送信キーの再送は最初の1件に収める (通信が切れて押し直しても2件にならない)
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  // 業務画面を開ける人は誰でも送れる。意見を言える人を絞ると、
  // 一番不便をしている入力担当の声が届かなくなる。
  if (!checkAccess(session, "view") || !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await readJsonBodyWithinLimit(request, IMPROVEMENT_REQUEST_MAX_BYTES);
  } catch (e) {
    if (e instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { message: "送信内容が大きすぎます。画像を外すか、撮り直してお試しください。" },
        { status: 413 },
      );
    }
    return NextResponse.json({ message: "送信内容の形式を確認してください。" }, { status: 400 });
  }

  const input = raw as {
    path?: unknown;
    body?: unknown;
    viewport?: unknown;
    shot?: unknown;
    submissionKey?: unknown;
  };

  if (!isAcceptableScreenPath(input.path)) {
    return NextResponse.json({ message: "画面のパスを確認してください。" }, { status: 400 });
  }
  if (typeof input.submissionKey !== "string" || !/^[0-9a-f-]{36}$/i.test(input.submissionKey)) {
    return NextResponse.json({ message: "送信内容の形式を確認してください。" }, { status: 400 });
  }
  if (typeof input.body !== "string" || input.body.length > IMPROVEMENT_BODY_MAX) {
    return NextResponse.json(
      { message: `改善したいことは${IMPROVEMENT_BODY_MAX}文字までで入力してください。` },
      { status: 400 },
    );
  }
  const body = normalizeImprovementBody(input.body);
  if (!body) {
    return NextResponse.json({ message: "改善したいことを入力してください。" }, { status: 400 });
  }

  const viewport =
    typeof input.viewport === "string" && /^\d{2,5}×\d{2,5}$/.test(input.viewport)
      ? input.viewport
      : null;
  const shot = typeof input.shot === "string" && input.shot.length > 0 ? input.shot : null;

  const route = routeIdentityOf(input.path);
  const repo = new D1ImprovementRepository(createDb(env.DB));

  // 再送かどうかを先に見る。連投の制限より前に置くのは、通信が切れて押し直した人を
  // 「送りすぎ」として断ってしまわないため。
  const existing = await repo.findBySubmissionKey(session.id, input.submissionKey);
  if (existing) {
    return NextResponse.json({ id: existing, message: "この改善要望は送信済みです。" });
  }

  const limited = consumeRateLimit(`improvement-submit:${session.id}`, IMPROVEMENT_SUBMIT_RATE_LIMIT);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        message: `送信が続いています。入力内容は残っています。${limited.retryAfterSeconds}秒後にもう一度お試しください。`,
      },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  if (shot && !isAcceptableShot(shot)) {
    return NextResponse.json(
      { message: "画像を受け取れませんでした。撮り直してお試しください。" },
      { status: 400 },
    );
  }

  try {
    const id = await repo.save({
      reporterId: session.id,
      reporterName: session.name,
      submissionKey: input.submissionKey,
      path: route.path,
      routePattern: route.routePattern,
      screenLabel: route.label,
      body,
      viewport,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      shot,
      shotBytes: shot ? shotBytesOf(shot) : 0,
    });
    return NextResponse.json({ id, message: "改善要望を送りました。ありがとうございます。" });
  } catch {
    // D1 の例外には画像の中身が含まれ得るため、そのまま外へ出さない。
    return NextResponse.json(
      { message: "保存できませんでした。入力内容は残っています。時間をおいてもう一度お試しください。" },
      { status: 500 },
    );
  }
}

/**
 * 届いた要望の一覧。管理者だけが読める。
 * 画面 (Server Component) はリポジトリを直接読むが、将来この一覧を機械で読んで
 * 改善案を作らせるときの入口としてここにも置く。
 */
export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_improvements")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const items = await new D1ImprovementRepository(createDb(env.DB)).listAll();
  return NextResponse.json({ items });
}
