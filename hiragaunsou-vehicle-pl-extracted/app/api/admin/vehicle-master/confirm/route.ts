import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../../src/infrastructure/db/client";
import { D1VehicleMasterRepository } from "../../../../../src/infrastructure/db/D1MasterRepository";
import { D1AuditLogRepository } from "../../../../../src/infrastructure/db/D1AuditLogRepository";
import { ConfirmImportVehicleMasterUseCase } from "../../../../../src/usecase/steps/importVehicleMaster";
import { STANDARD_COST_RATES } from "../../../../../src/domain/entities/VehiclePl";
import type { VehicleMasterUpsertInput } from "../../../../../src/domain/repositories/MasterRepository";
import { isSameOriginRequest } from "../../../../_lib/assertSameOrigin";

/** 金額として受け付けられる値に整える (負値・非数は0にする) */
function toAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * プレビュー結果はブラウザを経由して戻ってくるため、確定側でも型と原価カテゴリを検証し直す。
 * 未知の原価カテゴリを入れられると修繕費・タイヤ費の標準単価が引けず、収支が黙って0になる。
 */
function toUpsertInput(value: unknown): VehicleMasterUpsertInput | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  const vehicleNo = typeof r.vehicleNo === "string" ? r.vehicleNo.trim() : "";
  const costCategory = typeof r.costCategory === "string" ? r.costCategory : "";
  if (vehicleNo === "" || !(costCategory in STANDARD_COST_RATES)) return null;

  return {
    vehicleNo,
    vehicleType: typeof r.vehicleType === "string" ? r.vehicleType : "",
    depot: typeof r.depot === "string" ? r.depot : "",
    costCategory,
    insCompulsory: toAmount(r.insCompulsory),
    insVoluntary: toAmount(r.insVoluntary),
    taxAuto: toAmount(r.taxAuto),
    taxWeight: toAmount(r.taxWeight),
    lease: toAmount(r.lease),
    installment: toAmount(r.installment),
  };
}

/** 車両マスタCSV取込の確定 (プレビューで確認した正常行のみが送られてくる)。 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_imports")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { records?: unknown } | null;
  if (!Array.isArray(body?.records)) {
    return NextResponse.json({ error: "recordsが必要です" }, { status: 400 });
  }

  const records = body.records.map(toUpsertInput);
  if (records.some((r) => r === null)) {
    return NextResponse.json(
      { error: "車番または原価カテゴリが不正な行が含まれています" },
      { status: 400 },
    );
  }

  try {
    const db = createDb(env.DB);
    const result = await new ConfirmImportVehicleMasterUseCase(
      new D1VehicleMasterRepository(db),
      new D1AuditLogRepository(db),
    ).execute({
      actorId: session!.id,
      actorName: session!.name,
      records: records as VehicleMasterUpsertInput[],
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "車両マスタの取込に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
