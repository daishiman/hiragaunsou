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
import { recordFileImport } from "../../../../_lib/recordFileImport";
import { importDiffDetector, masterChangeStack } from "../../../../_lib/masterChangeStack";

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

  // けん引先は Excel の行の並びから復元できたときだけ入ってくる。値が無い場合は
  // キー自体を落として undefined のままにする。null を送ると upsert 側で
  // 「解除」と解釈され、人が画面で登録した対応が毎月の取込で消える。
  const towedBy = typeof r.towedByVehicleNo === "string" ? r.towedByVehicleNo.trim() : "";

  return {
    vehicleNo,
    ...(towedBy === "" ? {} : { towedByVehicleNo: towedBy }),
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

/** 車両マスタ取込の確定 (プレビューで確認した正常行のみが送られてくる)。 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_imports")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    records?: unknown;
    yearMonth?: unknown;
    fileName?: unknown;
    contentHash?: unknown;
  } | null;
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
    const vehicleMasterRepo = new D1VehicleMasterRepository(db);
    const result = await new ConfirmImportVehicleMasterUseCase(
      vehicleMasterRepo,
      new D1AuditLogRepository(db),
    ).execute({
      actorId: session!.id,
      actorName: session!.name,
      records: records as VehicleMasterUpsertInput[],
    });

    // 保険・税・リース料・けん引先は収支表の固定費そのものなので、土台を書き換えたら
    // 表も作り直す (けん引先の更新APIと同じ扱い)。ただしマスタの更新自体は既に済んでおり
    // 取り消せないため、まだ収支表が無い月などで失敗しても取込は成功として返し、
    // 画面側に「作り直せなかった」ことだけ伝える。
    await recordFileImport(db, {
      screen: "vehicle_master",
      fileName: body.fileName,
      contentHash: body.contentHash,
      rowCount: records.length,
      session: session!,
    });

    const yearMonth = typeof body.yearMonth === "string" ? body.yearMonth : "";

    // まだ締めていない月には自動で反映し、確定済みの月は据え置く。
    // 以前はいま見ている月だけを、確定済みかどうかに関わらず作り直していたため、
    // 締めた月の数字が黙って変わり、しかも確定まで外れていた。
    const actor = { id: session!.id, name: session!.name ?? "" };
    const applied = await masterChangeStack(db, actor).applier.execute({ edits: [], actor });

    // 前回の取込と何が変わったかを見つけて残す (画面のアラートはここが元になる)
    const alert = await importDiffDetector(db).execute({ persist: true });

    return NextResponse.json({
      ...result,
      yearMonth,
      recalculated: applied.appliedYearMonths.includes(yearMonth),
      applied: applied.appliedYearMonths,
      heldBack: applied.heldBackYearMonths,
      diffCount: alert.diffs.length,
      criticalCount: alert.criticalCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "車両マスタの取込に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
