import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../../src/infrastructure/db/D1ImprovementRepository";
import { syncIssues } from "../../../../../src/usecase/improvements/syncIssues";
import { buildIssueSyncDeps } from "../../../../../src/usecase/improvements/issueSyncDeps";
import { isSameOriginRequest } from "../../../../_lib/assertSameOrigin";

/**
 * 改善要望1件を GitHub Issue にする。管理者の操作からしか動かない。
 *
 * 利用者の投稿で勝手に起票しないのは、業務の中身がそのまま社外の場所へ出るため。
 * 誰かが押した1回だけ、内容を見た上で出す。
 *
 * 起票せずに文面だけ見る (dryRun) 道を必ず残す。起票先が決まる前でも
 * 「何が載るのか」を確かめられないと、出してよいかを判断できない。
 *
 * 中身の処理は一覧の一括送信と同じ syncIssues を通す。片方にだけ守りが入る
 * (二重起票の防止・空更新の抑止・対象外の除外) 状態を作らないため。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const body = raw as { dryRun?: unknown; reopenClosed?: unknown };
  const dryRun = body.dryRun === true;

  const { id } = await params;
  const repo = new D1ImprovementRepository(createDb(env.DB));
  const deps = buildIssueSyncDeps(env, repo, { id: session.id, name: session.name ?? "管理者" });
  const report = await syncIssues([id], deps, {
    dryRun,
    reopenClosed: body.reopenClosed === true,
  });

  const plan = report.plan.items[0];
  if (!plan) {
    return NextResponse.json({ message: "対象の要望が見つかりませんでした。" }, { status: 404 });
  }

  if (dryRun) {
    const draft = report.drafts[0];
    return NextResponse.json({
      dryRun: true,
      configured: report.configured,
      kind: plan.kind,
      title: draft?.title ?? "",
      body: draft?.body ?? "",
      labels: draft?.labels ?? [],
      message:
        plan.kind === "excluded"
          ? `この要望は${plan.reason}。`
          : plan.kind === "skip"
            ? plan.reason
            : plan.kind === "update"
              ? "起票はしていません。この内容で既存の Issue が更新されます。"
              : "起票はしていません。この内容で Issue が作られます。",
    });
  }

  const result = report.results[0];
  if (!result) {
    return NextResponse.json({ message: "対象の要望が見つかりませんでした。" }, { status: 404 });
  }

  // 送らなかった (対象外・変更なし) ものは、失敗ではなく「何もしていない」として返す。
  if (result.kind === "excluded" || result.kind === "skip") {
    return NextResponse.json({ ok: true, skipped: true, message: result.message });
  }

  if (!result.ok) {
    // 競合 (誰かが同じ要望を送っている最中) は、設定や通信の失敗と分ける。
    // こちらは待てば通るので、画面の出し方も再試行を促す形になる。
    const status = result.conflict ? 409 : report.configured ? 502 : 503;
    return NextResponse.json(
      {
        message: result.message,
        issueNumber: result.issueNumber,
        issueUrl: result.issueUrl,
        // 送ろうとした中身は失敗しても読めるようにする。
        body: report.drafts[0]?.body ?? "",
      },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    issueNumber: result.issueNumber,
    issueUrl: result.issueUrl,
    message: result.message,
  });
}
