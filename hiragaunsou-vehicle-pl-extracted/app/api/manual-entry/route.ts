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
import { FinalizeMonthlyPlUseCase } from "../../../src/usecase/steps/finalizeMonthlyPl";
import { buildManualInputs, type RawManualVehicleInput } from "../../../src/usecase/steps/buildManualInputs";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";

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

  const useCase = new FinalizeMonthlyPlUseCase(
    new D1ImportBatchRepository(db),
    new D1VehicleMasterRepository(db),
    new D1DriverMasterRepository(db),
    rateMasterRepo,
    new D1VehiclePlRepository(db),
  );

  try {
    const result = await useCase.execute({
      yearMonth: body.yearMonth,
      manualInputs: buildManualInputs(body.manualInputs),
    });
    return NextResponse.json({ yearMonth: result.yearMonth, vehicleCount: result.vehicleCount });
  } catch (e) {
    const message = e instanceof Error ? e.message : "手入力の確定に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
