import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../../src/infrastructure/db/D1ImportBatchRepository";
import {
  D1VehicleMasterRepository,
  D1DriverMasterRepository,
  D1RateMasterRepository,
} from "../../../../src/infrastructure/db/D1MasterRepository";
import { D1VehiclePlRepository } from "../../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ManualInputRepository } from "../../../../src/infrastructure/db/D1ManualInputRepository";
import {
  D1AppSettingRepository,
  D1CleansingDecisionRepository,
} from "../../../../src/infrastructure/db/D1CleansingDecisionRepository";
import { FinalizeMonthlyPlUseCase } from "../../../../src/usecase/steps/finalizeMonthlyPl";
import { RecalculateMonthlyPlUseCase } from "../../../../src/usecase/steps/recalculateMonthlyPl";
import { D1VehiclePlOverrideRepository } from "../../../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/** 金額として受け付けられる値に整える (負値・非数は0にする) */
function toAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * 業務フロー STEP7「運送費のリース料・割賦支払額に変更があれば都度修正する」。
 *
 * 収支表のセルを直接書き換えるのではなく、土台の車両マスタを直してから収支表を作り直す。
 * 「下流の値は手入力させない」原則を守りつつ、業務フローどおりの修正ができるようにする。
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
    vehicleNo?: string;
    lease?: number;
    installment?: number;
  } | null;

  if (!body?.yearMonth || !body.vehicleNo) {
    return NextResponse.json({ error: "yearMonth and vehicleNo are required" }, { status: 400 });
  }

  try {
    const db = createDb(env.DB);
    const vehicleMasterRepo = new D1VehicleMasterRepository(db);
    await vehicleMasterRepo.updateLeaseInstallment(
      body.vehicleNo,
      toAmount(body.lease),
      toAmount(body.installment),
    );

    // マスタを直したら収支表を作り直す (直した値が反映されていない表を残さない)。
    // 再計算の材料集めは RecalculateMonthlyPlUseCase に任せる。ここで自前に集めていたときは
    // キリン配賦を渡し忘れており、リース料を1台直すだけで24番・300番への配賦が消えていた。
    const rateMasterRepo = new D1RateMasterRepository(db);
    const result = await new RecalculateMonthlyPlUseCase(
      new D1ManualInputRepository(db),
      new D1CleansingDecisionRepository(db),
      new D1AppSettingRepository(db),
      rateMasterRepo,
      new D1VehiclePlOverrideRepository(db),
      new FinalizeMonthlyPlUseCase(
        new D1ImportBatchRepository(db),
        vehicleMasterRepo,
        new D1DriverMasterRepository(db),
        rateMasterRepo,
        new D1VehiclePlRepository(db),
      ),
    ).execute({ yearMonth: body.yearMonth });

    return NextResponse.json({
      yearMonth: body.yearMonth,
      vehicleNo: body.vehicleNo,
      vehicleCount: result.vehicleCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "リース料・割賦支払額の更新に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
