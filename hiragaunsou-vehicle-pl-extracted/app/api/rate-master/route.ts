import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import {
  D1RateMasterRepository,
  D1VehicleMasterRepository,
  D1DriverMasterRepository,
} from "../../../src/infrastructure/db/D1MasterRepository";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ManualInputRepository } from "../../../src/infrastructure/db/D1ManualInputRepository";
import {
  D1AppSettingRepository,
  D1CleansingDecisionRepository,
} from "../../../src/infrastructure/db/D1CleansingDecisionRepository";
import { D1VehiclePlOverrideRepository } from "../../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import { FinalizeMonthlyPlUseCase } from "../../../src/usecase/steps/finalizeMonthlyPl";
import { RecalculateMonthlyPlUseCase } from "../../../src/usecase/steps/recalculateMonthlyPl";
import {
  findRateMasterKeyDef,
  RATE_MASTER_CATALOG,
  validateRateValue,
} from "../../../src/domain/rules/rateMasterCatalog";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";

/**
 * 率マスタを触れる権限。
 *
 * 率は1つ書き換えると全車両・全月の数字が動くため、依頼者の判断で管理者だけに絞っている。
 * 画面(app/(app)/rate-settings/page.tsx)だけを塞いでも、入力担当は edit_master を持つので
 * APIを直接叩けば書き換えられてしまう。画面と裏側で同じ権限を使い、片方だけ緩い状態を作らない。
 *
 * 読み取り(GET)も同じ権限にする。この endpoint を呼ぶのは率マスタ設定の画面だけで、
 * 他の画面が使う率はサーバー側でリポジトリから直接読んでいるため、絞っても影響が無い。
 */
const RATE_MASTER_PERMISSION = "manage_imports" as const;

/** "2026-05" 形式か */
function isYearMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * GET /api/rate-master?ym=YYYY-MM
 * 設定できる項目の定義、実際に保存されている行、その月に適用される解決値をまとめて返す。
 *
 * 「保存されている行」と「解決値」を分けて返すのは、行が無いキーは既定値で動いていることを
 * 画面で示すため。既定値で動いている状態と、既定値と同じ値を明示的に設定した状態は別物で、
 * 前者は既定値を変えると黙って動く。
 */
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, RATE_MASTER_PERMISSION)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yearMonth = new URL(request.url).searchParams.get("ym");
  if (!isYearMonth(yearMonth)) {
    return NextResponse.json({ error: "ym is required (YYYY-MM)" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const repo = new D1RateMasterRepository(createDb(env.DB));
  const [entries, rates, thresholds] = await Promise.all([
    repo.listRates(),
    repo.getRates(yearMonth),
    repo.getDeficitThresholds(yearMonth),
  ]);

  return NextResponse.json({
    yearMonth,
    catalog: RATE_MASTER_CATALOG,
    entries,
    resolved: { ...rates, ...thresholds },
  });
}

/**
 * POST /api/rate-master
 * 率を1件保存し、対象月の収支表を作り直す。
 *
 * 保存だけして再計算しないと、画面の率と表の数字が食い違ったまま残る。
 * 率は全車両に効くので、食い違いに気づくのは月次の突合まで遅れる。
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, RATE_MASTER_PERMISSION)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    key?: string;
    /** null なら全期間共通値として保存する */
    yearMonth?: string | null;
    value?: number;
    /** 保存後に作り直す対象月。省略すると再計算しない */
    recalculateYearMonth?: string;
  } | null;

  const def = body?.key ? findRateMasterKeyDef(body.key) : undefined;
  if (!def) {
    return NextResponse.json({ error: "設定できないキーです" }, { status: 400 });
  }
  if (body?.yearMonth != null && !isYearMonth(body.yearMonth)) {
    return NextResponse.json({ error: "yearMonth は YYYY-MM か null です" }, { status: 400 });
  }

  const value = Number(body?.value);
  const validation = validateRateValue(def, value);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const db = createDb(env.DB);
    const rateMasterRepo = new D1RateMasterRepository(db);
    await rateMasterRepo.setRate(def.key, body?.yearMonth ?? null, value, session!.id);

    const target = body?.recalculateYearMonth;
    if (!isYearMonth(target)) {
      return NextResponse.json({ key: def.key, value, recalculated: null });
    }

    const result = await new RecalculateMonthlyPlUseCase(
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
    ).execute({ yearMonth: target });

    return NextResponse.json({
      key: def.key,
      value,
      recalculated: { yearMonth: target, vehicleCount: result.vehicleCount },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "率の保存に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
