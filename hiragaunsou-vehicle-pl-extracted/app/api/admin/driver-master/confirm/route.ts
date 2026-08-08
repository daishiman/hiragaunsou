import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../../src/infrastructure/db/client";
import {
  D1DriverMasterRepository,
  D1VehicleMasterRepository,
} from "../../../../../src/infrastructure/db/D1MasterRepository";
import { D1AuditLogRepository } from "../../../../../src/infrastructure/db/D1AuditLogRepository";
import { ConfirmImportDriverMasterUseCase } from "../../../../../src/usecase/steps/importDriverMaster";
import type { DriverMasterUpsertInput } from "../../../../../src/domain/repositories/MasterRepository";
import { isSameOriginRequest } from "../../../../_lib/assertSameOrigin";

/**
 * プレビュー結果はブラウザを経由して戻ってくるため、確定側でも形を検証し直す。
 * 社員コードが空の行を通すと、給与の紐付け先が決まらないまま行だけが増える。
 */
function toUpsertInput(value: unknown): DriverMasterUpsertInput | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  const employeeCode = typeof r.employeeCode === "string" ? r.employeeCode.trim() : "";
  const driverName = typeof r.driverName === "string" ? r.driverName.trim() : "";
  if (employeeCode === "" || driverName === "") return null;

  const vehicleNo = typeof r.vehicleNo === "string" ? r.vehicleNo.trim() : "";
  return { employeeCode, driverName, vehicleNo: vehicleNo === "" ? null : vehicleNo };
}

/** 運転者マスタCSV取込の確定 (プレビューで確認した正常行のみが送られてくる)。 */
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
      { error: "社員コードまたは氏名が空の行が含まれています" },
      { status: 400 },
    );
  }

  try {
    const db = createDb(env.DB);
    const result = await new ConfirmImportDriverMasterUseCase(
      new D1DriverMasterRepository(db),
      new D1VehicleMasterRepository(db),
      new D1AuditLogRepository(db),
    ).execute({
      actorId: session!.id,
      actorName: session!.name,
      records: records as DriverMasterUpsertInput[],
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "運転者マスタの取込に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
