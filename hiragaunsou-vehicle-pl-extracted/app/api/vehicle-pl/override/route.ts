import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehiclePlOverrideRepository } from "../../../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import { D1AuditLogRepository } from "../../../../src/infrastructure/db/D1AuditLogRepository";
import {
  ClearVehiclePlOverrideUseCase,
  SaveVehiclePlOverrideUseCase,
  VehiclePlOverrideConflictError,
} from "../../../../src/usecase/steps/saveVehiclePlOverride";
import { monthlyPlRecalculator as recalculator } from "../../../_lib/monthlyPlRecalculator";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

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
    /** 収支表への反映(再計算)を後回しにする。収支表の画面から続けて直すときに使う */
    deferRecalculation?: boolean;
    /** 画面が見ていたこの車両の直しの最終更新時刻。省略時は競合を検査しない */
    expectedUpdatedAt?: number | null;
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
      deferRecalculation: body.deferRecalculation === true,
      // undefined と null を区別する。null は「まだ直しが無いはず」という主張で、
      // 省略 (undefined) は「競合を見なくてよい」なので、まとめて既定値にできない。
      ...("expectedUpdatedAt" in (body as object)
        ? { expectedUpdatedAt: body.expectedUpdatedAt ?? null }
        : {}),
    });
    return NextResponse.json(result);
  } catch (e) {
    // 競合は入力の誤りではなく、先に直した人がいるという状態。画面が
    // 「開き直してください」と出せるよう、他のエラーと区別できる形で返す。
    if (e instanceof VehiclePlOverrideConflictError) {
      return NextResponse.json({ error: e.message, conflict: true }, { status: 409 });
    }
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
