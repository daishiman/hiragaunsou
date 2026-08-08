import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";
import {
  D1VehicleMasterRepository,
  D1DriverMasterRepository,
  D1RateMasterRepository,
  RATE_KEYS,
} from "../../../src/infrastructure/db/D1MasterRepository";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ManualInputRepository } from "../../../src/infrastructure/db/D1ManualInputRepository";
import { FinalizeMonthlyPlUseCase } from "../../../src/usecase/steps/finalizeMonthlyPl";
import { buildManualInputs, type RawManualVehicleInput } from "../../../src/usecase/steps/buildManualInputs";
import { DEFAULT_KIRIN_TARGET_VEHICLES } from "../../../src/domain/rules/kirinAllocation";
import {
  APP_SETTING_KEYS,
  D1AppSettingRepository,
  D1CleansingDecisionRepository,
} from "../../../src/infrastructure/db/D1CleansingDecisionRepository";
import {
  RecalculateMonthlyPlUseCase,
  parseVehicleNoList,
} from "../../../src/usecase/steps/recalculateMonthlyPl";
import { D1VehiclePlOverrideRepository } from "../../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";

/**
 * 入力途中の値を読み戻す (STEP3/5/6 は請求書の到着タイミングが違うため、
 * 何度も開き直して続きから入力できる必要がある)。
 */
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "input")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yearMonth = new URL(request.url).searchParams.get("yearMonth");
  if (!yearMonth) {
    return NextResponse.json({ error: "yearMonth is required" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const [records, kirinTargets] = await Promise.all([
    new D1ManualInputRepository(db).findByYearMonth(yearMonth),
    new D1AppSettingRepository(db).get(APP_SETTING_KEYS.kirinTargetVehicleNos),
  ]);
  return NextResponse.json({
    yearMonth,
    manualInputs: records,
    kirinTargetVehicleNos: parseVehicleNoList(kirinTargets) ?? [...DEFAULT_KIRIN_TARGET_VEHICLES],
  });
}

/**
 * 手入力フォーム(/manual-entry)の確定API。
 * 層③(修理費実費・インタンク単価・外部給油明細・その他例外上書き)を受け取り、
 * FinalizeMonthlyPlUseCase(既存の締めユースケース)に委譲して下流(固定費/変動費/損益等)を再計算する。
 * 「下流の値は絶対に手入力させない」原則(要件定義§2.3)に従い、このルートは値を集めて渡すだけ。
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
    tankPricePerLiter?: number;
    manualInputs?: RawManualVehicleInput[];
    /** STEP2 キリンの協力金。金額を渡すと対象車両の「その他」へ2等分で加算される */
    kirin?: {
      transportSupport?: number;
      managementSupport?: number;
      targetVehicleNos?: string[];
    };
    /**
     * true のとき収支表の再計算(確定)まで行わず、入力の保存だけする。
     * 請求書が全部揃う前に「ここまで入力した」を失わないための下書き保存。
     */
    saveOnly?: boolean;
  } | null;

  if (!body?.yearMonth || !Array.isArray(body.manualInputs)) {
    return NextResponse.json({ error: "yearMonth and manualInputs are required" }, { status: 400 });
  }

  const db = createDb(env.DB);
  const rateMasterRepo = new D1RateMasterRepository(db);

  if (typeof body.tankPricePerLiter === "number" && Number.isFinite(body.tankPricePerLiter)) {
    await rateMasterRepo.setRate(
      RATE_KEYS.tankPricePerLiter,
      body.yearMonth,
      Math.max(0, body.tankPricePerLiter),
      session!.id,
    );
  }

  const manualInputRepo = new D1ManualInputRepository(db);
  const appSettingRepo = new D1AppSettingRepository(db);
  const manualInputs = buildManualInputs(body.manualInputs);

  // 配賦先車番はコードに埋めず設定として持つ (専属車両が変われば24番・300番でなくなる)。
  const requestedTargets = parseVehicleNoList(body.kirin?.targetVehicleNos?.join(","));
  if (requestedTargets) {
    await appSettingRepo.set(
      APP_SETTING_KEYS.kirinTargetVehicleNos,
      requestedTargets.join(","),
      session!.id,
    );
  }
  // 受取額そのものを保存する。以前は配賦結果をこのリクエストの中だけで組み立てていたため、
  // 他の画面(リース料の更新など)から収支表を作り直すと配賦が復元できず消えていた。
  if (body.kirin) {
    await Promise.all([
      rateMasterRepo.setRate(
        RATE_KEYS.kirinTransportSupport,
        body.yearMonth,
        Math.max(0, body.kirin.transportSupport ?? 0),
        session!.id,
      ),
      rateMasterRepo.setRate(
        RATE_KEYS.kirinManagementSupport,
        body.yearMonth,
        Math.max(0, body.kirin.managementSupport ?? 0),
        session!.id,
      ),
    ]);
  }

  try {
    // 入力は先に保存する。確定に失敗しても入力が消えないようにするため。
    await manualInputRepo.upsertMany(
      body.yearMonth,
      manualInputs.map((m) => ({
        vehicleNo: m.vehicleNo,
        fuelInQty: m.fuelInQty,
        fuelOut: m.fuelOut,
        fuelOutQty: m.fuelOutQty,
        adblue: m.adblue,
        repairActual: m.repairActual,
        tireActual: m.tireActual ?? null,
        equip: m.equip,
        mainte: m.mainte,
        tollActual: m.tollActual ?? null,
        tollDiscountActual: m.tollDiscountActual ?? null,
        miscOther: m.miscOther,
      })),
      session!.id,
    );

    if (body.saveOnly) {
      return NextResponse.json({ yearMonth: body.yearMonth, saved: manualInputs.length });
    }

    // 材料集めは RecalculateMonthlyPlUseCase に任せる。保存済みの全車両分の手入力・
    // STEP2の整形判断・キリン配賦をDBから読み直すので、今回の画面で触っていない
    // 車両の入力や、他の画面で入れた値が落ちることがない。
    const result = await new RecalculateMonthlyPlUseCase(
      manualInputRepo,
      new D1CleansingDecisionRepository(db),
      appSettingRepo,
      rateMasterRepo,
      new D1VehiclePlOverrideRepository(db),
      new FinalizeMonthlyPlUseCase(
        new D1ImportBatchRepository(db),
        new D1VehicleMasterRepository(db),
        new D1DriverMasterRepository(db),
        rateMasterRepo,
        new D1VehiclePlRepository(db),
      ),
    ).execute({ yearMonth: body.yearMonth });
    return NextResponse.json({
      yearMonth: result.yearMonth,
      vehicleCount: result.vehicleCount,
      saved: manualInputs.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "手入力の確定に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
