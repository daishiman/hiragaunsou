import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../../src/infrastructure/db/client";
import {
  D1PlIssueAckRepository,
  MAX_BULK_ACK,
} from "../../../../../src/infrastructure/db/D1PlIssueAckRepository";
import { D1AuditLogRepository } from "../../../../../src/infrastructure/db/D1AuditLogRepository";
import {
  BulkAcknowledgePlIssuesUseCase,
  BulkUnacknowledgePlIssuesUseCase,
} from "../../../../../src/usecase/steps/acknowledgePlIssue";
import { VEHICLE_PL_FIELDS } from "../../../../../src/domain/entities/VehiclePl";
import { isReviewIssueCode } from "../../../../../src/domain/rules/vehiclePlReview";
import {
  isPlIssueAckStatus,
  type PlIssueAckKey,
} from "../../../../../src/domain/rules/plIssueAck";
import { isSameOriginRequest } from "../../../../_lib/assertSameOrigin";

interface RawTarget {
  vehicleNo?: string;
  field?: string;
  code?: string;
  value?: number;
}

/**
 * まとめて処理する対象を検査する。
 *
 * 1件でも知らない列名・知らない指摘の種類が混ざっていたら、全体を断る。
 * 「通ったものだけ処理しました」は、まとめ操作では何が処理されたか分からなくなるため。
 */
function parseTargets(
  raw: unknown,
): (PlIssueAckKey & { value: number | null })[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "まとめる対象がありません" };
  }
  if (raw.length > MAX_BULK_ACK) {
    return { error: `一度にまとめて処理できるのは${MAX_BULK_ACK}件までです` };
  }
  const parsed: (PlIssueAckKey & { value: number | null })[] = [];
  for (const item of raw as RawTarget[]) {
    const { vehicleNo, field, code, value } = item ?? {};
    if (!vehicleNo || !field || !code) {
      return { error: "vehicleNo / field / code が必要です" };
    }
    if (!(VEHICLE_PL_FIELDS as readonly string[]).includes(field)) {
      return { error: `「${field}」は収支表の項目ではありません` };
    }
    if (!isReviewIssueCode(code)) {
      return { error: `「${code}」は指摘の種類として扱えません` };
    }
    parsed.push({
      vehicleNo,
      field,
      code,
      value: typeof value === "number" && Number.isFinite(value) ? value : null,
    });
  }
  return parsed;
}

/** 同じ種類の指摘をまとめて「問題なし」(または「あとで見る」)にする。 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "input")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    yearMonth?: string;
    targets?: unknown;
    status?: string;
    note?: string;
    reason?: string;
  } | null;

  if (!body?.yearMonth) {
    return NextResponse.json({ error: "yearMonth が必要です" }, { status: 400 });
  }
  const status = body.status ?? "ok";
  if (!isPlIssueAckStatus(status)) {
    return NextResponse.json({ error: `「${status}」は判断として扱えません` }, { status: 400 });
  }
  const targets = parseTargets(body.targets);
  if ("error" in targets) return NextResponse.json({ error: targets.error }, { status: 400 });

  const db = createDb(env.DB);
  const { count } = await new BulkAcknowledgePlIssuesUseCase(
    new D1PlIssueAckRepository(db),
    new D1AuditLogRepository(db),
  ).execute({
    yearMonth: body.yearMonth,
    targets,
    status,
    note: body.note ?? null,
    reason: body.reason?.trim() || "まとめて選んだ指摘",
    actorId: session!.id,
    actorName: session!.name,
  });

  return NextResponse.json({ count, status, ackedByName: session!.name });
}

/** まとめて付けた判断をまとめて取り消す (「元に戻す」)。 */
export async function DELETE(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "input")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    yearMonth?: string;
    targets?: unknown;
  } | null;
  if (!body?.yearMonth) {
    return NextResponse.json({ error: "yearMonth が必要です" }, { status: 400 });
  }
  const targets = parseTargets(body.targets);
  if ("error" in targets) return NextResponse.json({ error: targets.error }, { status: 400 });

  const db = createDb(env.DB);
  const { count } = await new BulkUnacknowledgePlIssuesUseCase(
    new D1PlIssueAckRepository(db),
    new D1AuditLogRepository(db),
  ).execute({
    yearMonth: body.yearMonth,
    targets,
    actorId: session!.id,
    actorName: session!.name,
  });

  return NextResponse.json({ count });
}
