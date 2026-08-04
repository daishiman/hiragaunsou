import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";
import { D1CleansingDecisionRepository } from "../../../src/infrastructure/db/D1CleansingDecisionRepository";
import {
  CLEANSING_SOURCE_TYPE,
  GetCleansingQueueUseCase,
} from "../../../src/usecase/steps/getCleansingQueue";
import type { CleansingDecisionRecord } from "../../../src/domain/repositories/CleansingDecisionRepository";
import type {
  CleansingDecisionType,
  CleansingFlagType,
} from "../../../src/domain/rules/cleansingRules";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";

const VALID_DECISIONS: readonly CleansingDecisionType[] = ["delete", "correct", "keep"];

/** STEP2 データ整形の要判断リストを返す */
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yearMonth = new URL(request.url).searchParams.get("yearMonth");
  if (!yearMonth) {
    return NextResponse.json({ error: "yearMonth is required" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const useCase = new GetCleansingQueueUseCase(
    new D1ImportBatchRepository(db),
    new D1CleansingDecisionRepository(db),
  );
  return NextResponse.json(await useCase.execute(yearMonth));
}

/**
 * STEP2 データ整形の判断を保存する。
 *
 * 元データ(raw_ingestion)は書き換えず判断だけを別テーブルへ残す。
 * これにより判断のやり直しに再取込が不要になり、
 * 「なぜこの伝票が収支表に入っていないのか」を後から説明できる。
 */
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
    decisions?: {
      rowKey?: string;
      vehicleNo?: string;
      driverName?: string;
      flagTypes?: CleansingFlagType[];
      decision?: string;
      correctedVehicleNo?: string | null;
      note?: string | null;
    }[];
  } | null;

  if (!body?.yearMonth || !Array.isArray(body.decisions)) {
    return NextResponse.json({ error: "yearMonth and decisions are required" }, { status: 400 });
  }

  const yearMonth = body.yearMonth;
  const records: CleansingDecisionRecord[] = [];

  for (const d of body.decisions) {
    const rowKey = (d.rowKey ?? "").trim();
    if (rowKey === "") continue;
    if (!VALID_DECISIONS.includes(d.decision as CleansingDecisionType)) {
      return NextResponse.json(
        { error: `不正な判断です: ${String(d.decision)}` },
        { status: 400 },
      );
    }
    const corrected = (d.correctedVehicleNo ?? "").trim();
    records.push({
      yearMonth,
      sourceType: CLEANSING_SOURCE_TYPE,
      rowKey,
      vehicleNo: d.vehicleNo ?? null,
      driverName: d.driverName ?? null,
      flagTypes: Array.isArray(d.flagTypes) ? d.flagTypes : [],
      decision: d.decision as CleansingDecisionType,
      correctedVehicleNo: corrected === "" ? null : corrected,
      note: (d.note ?? "").trim() === "" ? null : (d.note ?? null),
    });
  }

  try {
    const db = createDb(env.DB);
    await new D1CleansingDecisionRepository(db).upsertMany(records, session!.id);
    return NextResponse.json({ yearMonth, saved: records.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "判断の保存に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
