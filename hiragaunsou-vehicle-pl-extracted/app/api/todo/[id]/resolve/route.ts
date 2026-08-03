import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../../src/infrastructure/auth/session";
import { hasPermission } from "../../../../../src/domain/rules/permissions";
import { D1ReviewFlagRepository } from "../../../../../src/infrastructure/db/D1ReviewFlagRepository";
import { createDb } from "../../../../../src/infrastructure/db/client";
import { isSameOriginRequest } from "../../../../_lib/assertSameOrigin";

/** 要確認カードを「修正/実績として承認/却下」の3択で捌く (要件定義L4-2) */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session || !hasPermission(session.role, "approve_anomaly")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    action: "corrected" | "approved" | "dismissed";
    note?: string;
  };

  const repo = new D1ReviewFlagRepository(createDb(env.DB));
  await repo.resolve(id, session.id, body.action, body.note ?? null);

  return NextResponse.json({ ok: true });
}
