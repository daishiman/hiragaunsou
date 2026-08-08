import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../../src/infrastructure/db/D1ImportBatchRepository";
import {
  D1DriverMasterRepository,
  D1RateMasterRepository,
  D1VehicleMasterRepository,
} from "../../../../src/infrastructure/db/D1MasterRepository";
import { D1VehiclePlRepository } from "../../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ManualInputRepository } from "../../../../src/infrastructure/db/D1ManualInputRepository";
import { D1VehiclePlOverrideRepository } from "../../../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import { D1AuditLogRepository } from "../../../../src/infrastructure/db/D1AuditLogRepository";
import {
  D1AppSettingRepository,
  D1CleansingDecisionRepository,
} from "../../../../src/infrastructure/db/D1CleansingDecisionRepository";
import { FinalizeMonthlyPlUseCase } from "../../../../src/usecase/steps/finalizeMonthlyPl";
import { RecalculateMonthlyPlUseCase } from "../../../../src/usecase/steps/recalculateMonthlyPl";
import {
  ClearVehiclePlOverrideUseCase,
  SaveVehiclePlOverrideUseCase,
} from "../../../../src/usecase/steps/saveVehiclePlOverride";
import type { Db } from "../../../../src/infrastructure/db/client";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 再計算の材料集めは RecalculateMonthlyPlUseCase に閉じ込めてある。
 * ここで自前に集めるとキリン配賦や整形判断を渡し忘れ、上書きを1件保存しただけで
 * 別の車両の値が消える。年月しか渡さない形を保つこと。
 */
function recalculator(db: Db) {
  const rateMasterRepo = new D1RateMasterRepository(db);
  return new RecalculateMonthlyPlUseCase(
    new D1ManualInputRepository(db),
    new D1CleansingDecisionRepository(db),
    new D1AppSettingRepository(db),
    rateMasterRepo,
    new D1VehiclePlOverrideRepository(db),
    new FinalizeMonthlyPlUseCase(
      new D1ImportBatchRepository(db),
      new D1VehicleMasterRepository(db),
      new D1DriverMasterRepository(db),
      rateMasterRepo,
      new D1VehiclePlRepository(db),
    ),
  );
}

/** その月の上書き一覧 (収支表の画面で「人が直した行」を示すために使う)。 */
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yearMonth = new URL(request.url).searchParams.get("yearMonth");
  if (!yearMonth) {
    return NextResponse.json({ error: "yearMonth is required (YYYY-MM)" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const overrides = await new D1VehiclePlOverrideRepository(
    createDb(env.DB),
  ).findByYearMonth(yearMonth);
  return NextResponse.json({ yearMonth, overrides });
}

/** 上書きの保存 → 収支表の再計算まで。 */
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
    vehicleNo?: string;
    excluded?: boolean;
    values?: Record<string, unknown>;
    reason?: string;
  } | null;

  if (!body?.yearMonth || !body.vehicleNo) {
    return NextResponse.json({ error: "yearMonth と vehicleNo が必要です" }, { status: 400 });
  }

  // 値の妥当性(上書き可能な項目か・数値か)はユースケース側で判定する。
  // ここで通す形だけ整えておくと、画面を経由しない呼び出しでも同じ検査が効く。
  const values: Record<string, number> = {};
  for (const [field, value] of Object.entries(body.values ?? {})) {
    const n = typeof value === "number" ? value : Number(value);
    if (value === null || value === "" || Number.isNaN(n)) continue;
    values[field] = n;
  }

  const db = createDb(env.DB);
  try {
    const result = await new SaveVehiclePlOverrideUseCase(
      new D1VehiclePlOverrideRepository(db),
      recalculator(db),
      new D1AuditLogRepository(db),
    ).execute({
      yearMonth: body.yearMonth,
      vehicleNo: body.vehicleNo,
      excluded: body.excluded === true,
      values,
      reason: body.reason ?? "",
      actorId: session!.id,
      actorName: session!.name,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "上書きの保存に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** 上書きの取り消し → 収支表の再計算まで。 */
export async function DELETE(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "input")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const yearMonth = url.searchParams.get("yearMonth");
  const vehicleNo = url.searchParams.get("vehicleNo");
  if (!yearMonth || !vehicleNo) {
    return NextResponse.json({ error: "yearMonth と vehicleNo が必要です" }, { status: 400 });
  }

  const db = createDb(env.DB);
  try {
    const result = await new ClearVehiclePlOverrideUseCase(
      new D1VehiclePlOverrideRepository(db),
      recalculator(db),
      new D1AuditLogRepository(db),
    ).execute({
      yearMonth,
      vehicleNo,
      actorId: session!.id,
      actorName: session!.name,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "上書きの取り消しに失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
