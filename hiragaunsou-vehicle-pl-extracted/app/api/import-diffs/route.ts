import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { importDiffAckRepository, importDiffDetector } from "../../_lib/masterChangeStack";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";

/**
 * 「前回と異なります」の一覧は、月次の入力をする人が見るもの。
 * 直すのは管理者だけだが、気づくのは入力担当のほうが早いので、読み取りは入力権限で通す。
 */
const READ_PERMISSION = "input" as const;
/** 確認済みにするのは判断を伴うので、マスタと同じ管理者権限に揃える */
const ACK_PERMISSION = "manage_imports" as const;

/**
 * GET /api/import-diffs
 * 前回の取込と今回で何が変わったかを返す。読むだけで、写しは更新しない。
 */
export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, READ_PERMISSION)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  try {
    const alert = await importDiffDetector(createDb(env.DB)).execute({ persist: false });
    return NextResponse.json(alert);
  } catch (e) {
    const message = e instanceof Error ? e.message : "違いの確認に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/import-diffs
 * 見て納得したものを「確認済み」にする (次から出さない)。undo に true を渡すと戻す。
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, ACK_PERMISSION)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    fingerprints?: unknown;
    targetKind?: unknown;
    targetLabel?: unknown;
    summary?: unknown;
    undo?: unknown;
  } | null;

  const fingerprints = Array.isArray(body?.fingerprints)
    ? body.fingerprints.filter((v): v is string => typeof v === "string" && v !== "")
    : [];
  if (fingerprints.length === 0) {
    return NextResponse.json({ error: "対象が指定されていません" }, { status: 400 });
  }

  const repo = importDiffAckRepository(createDb(env.DB));
  try {
    for (const fingerprint of fingerprints) {
      if (body?.undo === true) {
        await repo.unack(fingerprint);
      } else {
        await repo.ack({
          fingerprint,
          targetKind: typeof body?.targetKind === "string" ? body.targetKind : "",
          targetLabel: typeof body?.targetLabel === "string" ? body.targetLabel : "",
          summary: typeof body?.summary === "string" ? body.summary : "",
          actor: { id: session!.id, name: session!.name ?? "" },
        });
      }
    }
    return NextResponse.json({ count: fingerprints.length, undo: body?.undo === true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "確認済みにできませんでした";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
