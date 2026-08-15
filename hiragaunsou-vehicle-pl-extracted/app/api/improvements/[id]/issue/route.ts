import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../../src/infrastructure/db/D1ImprovementRepository";
import { buildIssueDraft } from "../../../../../src/domain/rules/improvementIssue";
import {
  GitHubIssueClient,
  GitHubIssueError,
  githubIssueConfigOf,
} from "../../../../../src/infrastructure/github/GitHubIssueClient";
import { isSameOriginRequest } from "../../../../_lib/assertSameOrigin";

/**
 * 改善要望を GitHub Issue にする。管理者の操作からしか動かない。
 *
 * 利用者の投稿で勝手に起票しないのは、業務の中身がそのまま社外の場所へ出るため。
 * 誰かが押した1回だけ、内容を見た上で出す。
 *
 * 起票せずに文面だけ見る (dryRun) 道を必ず残す。起票先が決まる前でも
 * 「何が載るのか」を確かめられないと、出してよいかを判断できない。
 */

/** 起票の権利を持てる時間。GitHubの応答待ちより十分長く、詰まったままにはならない長さ。 */
const ISSUE_LEASE_MS = 60_000;

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
  const dryRun = (raw as { dryRun?: unknown }).dryRun === true;

  const { id } = await params;
  const repo = new D1ImprovementRepository(createDb(env.DB));
  const item = await repo.findById(id);
  if (!item) {
    return NextResponse.json({ message: "対象の要望が見つかりませんでした。" }, { status: 404 });
  }

  const draft = buildIssueDraft(item, {
    appOrigin: env.BETTER_AUTH_URL,
    // 画像を社外から見える場所へ出さない。出してよいかは持ち主にしか決められないので、
    // 既定は「Issueには載せず、管理画面で見る」にしておく。
    shotUrl: null,
  });

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      configured: githubIssueConfigOf(env) !== null,
      title: draft.title,
      body: draft.body,
      labels: draft.labels,
      message: "起票はしていません。この内容で Issue が作られます。",
    });
  }

  // 既に起票済みなら、ここで止める (押し直しても2本目は立たない)。
  if (item.githubIssueNumber !== null) {
    return NextResponse.json(
      {
        message: `この要望は Issue #${item.githubIssueNumber} として起票済みです。`,
        issueNumber: item.githubIssueNumber,
        issueUrl: item.githubIssueUrl,
      },
      { status: 409 },
    );
  }

  const config = githubIssueConfigOf(env);
  if (!config) {
    return NextResponse.json(
      {
        message:
          "起票先の設定がまだありません。GitHubの起票先リポジトリとトークンを登録すると押せるようになります（下書きの確認は今でもできます）。",
        title: draft.title,
        body: draft.body,
        labels: draft.labels,
      },
      { status: 503 },
    );
  }

  // GitHub へ投げる前に権利を取る。番号は投げた後にしか分からないため、
  // 番号の有無だけを見ていると「投げている最中の2回目」を止められない。
  const claimed = await repo.beginIssuing(id, ISSUE_LEASE_MS);
  if (!claimed) {
    return NextResponse.json(
      { message: "いま起票の処理中です。少し待ってから画面を開き直してください。" },
      { status: 409 },
    );
  }

  let issued;
  try {
    issued = await new GitHubIssueClient(config).create(draft);
  } catch (e) {
    await repo.releaseIssuing(id);
    const message =
      e instanceof GitHubIssueError ? e.message : "GitHubへ起票できませんでした。";
    return NextResponse.json({ message }, { status: 502 });
  }

  const saved = await repo.markIssued(id, {
    issueNumber: issued.number,
    issueUrl: issued.url,
    issuedById: session.id,
  });
  if (!saved) {
    // 起票はできたのに結び付けだけ失敗した場合。番号を握り潰すと迷子の Issue になるので、
    // 「作られたが結び付いていない」ことを URL 付きで伝える。
    return NextResponse.json(
      {
        message: `Issue #${issued.number} は作成されましたが、要望との結び付けに失敗しました。重複していないか確認してください。`,
        issueNumber: issued.number,
        issueUrl: issued.url,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    issueNumber: issued.number,
    issueUrl: issued.url,
    message: `Issue #${issued.number} を作成しました。`,
  });
}
