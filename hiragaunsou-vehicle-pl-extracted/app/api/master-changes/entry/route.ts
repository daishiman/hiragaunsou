import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import {
  D1DriverMasterRepository,
  D1VehicleMasterRepository,
} from "../../../../src/infrastructure/db/D1MasterRepository";
import { masterChangeStack } from "../../../_lib/masterChangeStack";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";
import { MASTER_CHANGE_PERMISSION } from "../route";
import {
  EDITABLE_DRIVER_FIELDS,
  EDITABLE_VEHICLE_FIELDS,
} from "../../../../src/infrastructure/db/D1MasterValueWriter";

/** 画面に出す項目名。ここに無い項目は直せない */
const VEHICLE_FIELD_LABELS: Record<string, string> = {
  vehicleType: "車種",
  depot: "車庫",
  costCategory: "原価の区分",
  insCompulsory: "自賠責保険",
  insVoluntary: "任意保険",
  taxAuto: "自動車税",
  taxWeight: "重量税",
  lease: "リース料",
  installment: "割賦の支払",
  towedByVehicleNo: "けん引するトラクタ",
};

const DRIVER_FIELD_LABELS: Record<string, string> = {
  driverName: "氏名",
  vehicleNo: "乗っている車",
};

/**
 * POST /api/master-changes/entry
 * 車両マスタ・運転者マスタを1件だけ直す。
 *
 * これまではCSVを丸ごと入れ直すしか手が無く、1台のリース料を直したいだけでも
 * 全件のCSVを作り直す必要があった。直したい1項目だけを送れる入口をここに用意する。
 *
 * 反映の決まりは他の直しと同じ (まだ締めていない月は自動、確定済みの月は据え置き)。
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, MASTER_CHANGE_PERMISSION)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    targetKind?: unknown;
    targetKey?: unknown;
    field?: unknown;
    value?: unknown;
  } | null;

  const targetKind = body?.targetKind;
  const targetKey = typeof body?.targetKey === "string" ? body.targetKey.trim() : "";
  const field = typeof body?.field === "string" ? body.field : "";
  const value = body?.value == null ? "" : String(body.value);

  if ((targetKind !== "vehicle" && targetKind !== "driver") || targetKey === "") {
    return NextResponse.json({ error: "直す対象が指定されていません" }, { status: 400 });
  }

  const allowed =
    targetKind === "vehicle"
      ? (EDITABLE_VEHICLE_FIELDS as readonly string[])
      : (EDITABLE_DRIVER_FIELDS as readonly string[]);
  if (!allowed.includes(field)) {
    return NextResponse.json({ error: "この項目は画面からは直せません" }, { status: 400 });
  }

  const db = createDb(env.DB);
  const actor = { id: session!.id, name: session!.name ?? "" };
  const stack = masterChangeStack(db, actor);

  try {
    // 直す前の値を控えてから書く。控えないと履歴が「何から何へ」を示せず、元に戻せない。
    let beforeValue: string | null = null;
    let targetLabel = targetKey;

    if (targetKind === "vehicle") {
      const current = (await new D1VehicleMasterRepository(db).findAllActive()).find(
        (v) => v.vehicleNo === targetKey,
      );
      if (!current) {
        return NextResponse.json({ error: "その車番が車両マスタにありません" }, { status: 400 });
      }
      const raw = (current as unknown as Record<string, unknown>)[field];
      beforeValue = raw == null ? null : String(raw);
      targetLabel = `車番 ${targetKey}`;
    } else {
      const current = (await new D1DriverMasterRepository(db).findAll()).find(
        (d) => d.employeeCode === targetKey,
      );
      if (!current) {
        return NextResponse.json(
          { error: "その社員コードが運転者マスタにありません" },
          { status: 400 },
        );
      }
      const raw = (current as unknown as Record<string, unknown>)[field];
      beforeValue = raw == null ? null : String(raw);
      targetLabel = current.driverName || `社員コード ${targetKey}`;
    }

    await stack.writer.write({ targetKind, targetKey, field, value });

    const applied = await stack.applier.execute({
      edits: [
        {
          targetKind,
          targetKey,
          targetLabel,
          field,
          fieldLabel:
            (targetKind === "vehicle" ? VEHICLE_FIELD_LABELS : DRIVER_FIELD_LABELS)[field] ?? field,
          beforeValue,
          afterValue: value,
        },
      ],
      actor,
    });

    return NextResponse.json({
      targetLabel,
      beforeValue,
      afterValue: value,
      applied: applied.appliedYearMonths,
      heldBack: applied.heldBackYearMonths,
    });
  } catch (e) {
    return NextResponse.json({ error: readableMessage(e) }, { status: 400 });
  }
}

/**
 * 画面に出す言葉に直す。
 * DBが返す "D1_ERROR: FOREIGN KEY constraint failed..." のような文をそのまま出すと、
 * 読んだ人が何を直せばいいのか分からないまま手が止まる。
 */
function readableMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : "";
  if (raw === "") return "直せませんでした";
  if (/D1_ERROR|SQLITE|constraint failed/i.test(raw)) {
    return "この内容では保存できませんでした。入れた値が他のマスタにあるか確かめてください";
  }
  return raw;
}
