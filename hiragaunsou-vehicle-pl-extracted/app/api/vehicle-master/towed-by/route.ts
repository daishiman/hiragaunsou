import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehicleMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { masterChangeStack } from "../../../_lib/masterChangeStack";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * トレーラ(被けん引車)とトラクタの対応づけ。
 *
 * トレーラは車検証上は別車両なので保険・税・リース料が単独で付くが、運転者も運賃も付かない。
 * 対応づけないと「売上ゼロ・費用だけの赤字行」がそのまま収支表に並ぶ。
 * 対応表は元データのどのCSVにも無いので、ここが唯一の登録経路になる。
 *
 * 車両マスタを直したら収支表は必ず作り直す。表と土台がずれた状態を残さないため。
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
    towedByVehicleNo?: string | null;
  } | null;

  if (!body?.yearMonth || !body.vehicleNo) {
    return NextResponse.json(
      { error: "yearMonth と vehicleNo が必要です" },
      { status: 400 },
    );
  }

  const towedBy =
    typeof body.towedByVehicleNo === "string" && body.towedByVehicleNo.trim() !== ""
      ? body.towedByVehicleNo.trim()
      : null;

  try {
    const db = createDb(env.DB);
    const vehicleMasterRepo = new D1VehicleMasterRepository(db);
    const before = (await vehicleMasterRepo.findAllActive()).find(
      (v) => v.vehicleNo === body.vehicleNo,
    );

    await vehicleMasterRepo.updateTowedBy(body.vehicleNo, towedBy);

    // まだ締めていない月には自動で反映し、確定済みの月は据え置く。
    const actor = { id: session!.id, name: session!.name ?? "" };
    const applied = await masterChangeStack(db, actor).applier.execute({
      edits: [
        {
          targetKind: "vehicle" as const,
          targetKey: body.vehicleNo,
          targetLabel: `車番 ${body.vehicleNo}`,
          field: "towedByVehicleNo",
          fieldLabel: "けん引するトラクタ",
          beforeValue: before?.towedByVehicleNo ?? null,
          afterValue: towedBy,
        },
      ],
      actor,
    });

    return NextResponse.json({
      vehicleNo: body.vehicleNo,
      towedByVehicleNo: towedBy,
      applied: applied.appliedYearMonths,
      heldBack: applied.heldBackYearMonths,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "けん引先の更新に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
