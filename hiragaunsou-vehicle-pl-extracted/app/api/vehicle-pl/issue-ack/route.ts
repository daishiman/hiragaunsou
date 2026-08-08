import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1PlIssueAckRepository } from "../../../../src/infrastructure/db/D1PlIssueAckRepository";
import { D1AuditLogRepository } from "../../../../src/infrastructure/db/D1AuditLogRepository";
import {
  AcknowledgePlIssueUseCase,
  UnacknowledgePlIssueUseCase,
} from "../../../../src/usecase/steps/acknowledgePlIssue";
import { VEHICLE_PL_FIELDS } from "../../../../src/domain/entities/VehiclePl";
import {
  isReviewIssueCode,
  type ReviewIssueCode,
} from "../../../../src/domain/rules/vehiclePlReview";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

interface AckKeyInput {
  yearMonth: string;
  vehicleNo: string;
  field: string;
  code: ReviewIssueCode;
}

/** 画面・URLから来る生の値 (この時点では列名も指摘の種類も信用しない) */
type RawAckKeyInput = Partial<Record<keyof AckKeyInput, string>>;

/**
 * 指摘を指す4つ組を検査する。
 *
 * 指摘そのものはDBに無く導出されるので、ここを通った値がそのままキーになる。
 * 知らない列名・知らない指摘の種類を通すと、二度と画面に現れない印が溜まり続ける。
 */
function parseKey(raw: RawAckKeyInput | null): AckKeyInput | { error: string } {
  const { yearMonth, vehicleNo, field, code } = raw ?? {};
  if (!yearMonth || !vehicleNo || !field || !code) {
    return { error: "yearMonth / vehicleNo / field / code が必要です" };
  }
  if (!(VEHICLE_PL_FIELDS as readonly string[]).includes(field)) {
    return { error: `「${field}」は収支表の項目ではありません` };
  }
  if (!isReviewIssueCode(code)) {
    return { error: `「${code}」は指摘の種類として扱えません` };
  }
  return { yearMonth, vehicleNo, field, code };
}

/** 指摘を「確認しました。このままでよい」にする。 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "input")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | (RawAckKeyInput & { note?: string })
    | null;
  const key = parseKey(body);
  if ("error" in key) return NextResponse.json({ error: key.error }, { status: 400 });

  const db = createDb(env.DB);
  await new AcknowledgePlIssueUseCase(
    new D1PlIssueAckRepository(db),
    new D1AuditLogRepository(db),
  ).execute({
    ...key,
    note: body?.note ?? null,
    actorId: session!.id,
    actorName: session!.name,
  });

  return NextResponse.json({ ...key, acknowledged: true, ackedByName: session!.name });
}

/** 確認済みを取り消して、もう一度確認対象に戻す。 */
export async function DELETE(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "input")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const key = parseKey({
    yearMonth: params.get("yearMonth") ?? undefined,
    vehicleNo: params.get("vehicleNo") ?? undefined,
    field: params.get("field") ?? undefined,
    code: params.get("code") ?? undefined,
  });
  if ("error" in key) return NextResponse.json({ error: key.error }, { status: 400 });

  const db = createDb(env.DB);
  await new UnacknowledgePlIssueUseCase(
    new D1PlIssueAckRepository(db),
    new D1AuditLogRepository(db),
  ).execute({
    ...key,
    actorId: session!.id,
    actorName: session!.name,
  });

  return NextResponse.json({ ...key, acknowledged: false });
}
