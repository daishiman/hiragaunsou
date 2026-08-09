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
import type { MasterEditInput } from "../../../../src/usecase/steps/applyMasterChange";

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

interface EntryInput {
  targetKind: "vehicle" | "driver";
  targetKey: string;
  field: string;
  value: string;
}

/**
 * POST /api/master-changes/entries
 * 車両マスタ・運転者マスタの直しを「まとめて」保存する。
 *
 * 1件ずつの入口 (/entry) と業務上の意味は同じだが、こちらは画面で直した数だけまとめて受ける。
 * 分けている理由は2つ:
 *
 * 1. 収支表の作り直しを最後に1回だけにするため。1件ずつ送ると、10項目直しただけで
 *    未確定の全月ぶんの収支表を10回作り直すことになる。
 * 2. 一部だけ保存できなかったことを、項目ごとに返すため。まとめて失敗にすると
 *    「どれが保存できたのか」が分からず、全部打ち直しになる。
 *
 * 反映の決まりは1件ずつの入口と同じ (まだ締めていない月は自動、確定済みの月は据え置き)。
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

  const body = (await request.json().catch(() => null)) as { edits?: unknown } | null;
  const rawEdits = Array.isArray(body?.edits) ? body.edits : null;
  if (!rawEdits || rawEdits.length === 0) {
    return NextResponse.json({ error: "直す内容がありません" }, { status: 400 });
  }
  if (rawEdits.length > 500) {
    return NextResponse.json({ error: "一度に保存できるのは500項目までです" }, { status: 400 });
  }

  const edits: EntryInput[] = [];
  for (const raw of rawEdits) {
    const e = raw as Record<string, unknown>;
    const targetKind = e.targetKind;
    const targetKey = typeof e.targetKey === "string" ? e.targetKey.trim() : "";
    const field = typeof e.field === "string" ? e.field : "";
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
    edits.push({ targetKind, targetKey, field, value: e.value == null ? "" : String(e.value) });
  }

  const db = createDb(env.DB);
  const actor = { id: session!.id, name: session!.name ?? "" };
  const stack = masterChangeStack(db, actor);

  // 直す前の値を先に控える。控えないと履歴が「何から何へ」を示せず、元に戻せない。
  const vehicles = await new D1VehicleMasterRepository(db).findAllActive();
  const drivers = await new D1DriverMasterRepository(db).findAll();

  const recorded: MasterEditInput[] = [];
  const failures: { targetKey: string; field: string; message: string }[] = [];

  for (const edit of edits) {
    const current =
      edit.targetKind === "vehicle"
        ? vehicles.find((v) => v.vehicleNo === edit.targetKey)
        : drivers.find((d) => d.employeeCode === edit.targetKey);
    if (!current) {
      failures.push({
        targetKey: edit.targetKey,
        field: edit.field,
        message:
          edit.targetKind === "vehicle"
            ? "その車番が車両マスタにありません"
            : "その社員Noが運転者マスタにありません",
      });
      continue;
    }
    const raw = (current as unknown as Record<string, unknown>)[edit.field];
    const beforeValue = raw == null ? null : String(raw);
    const targetLabel =
      edit.targetKind === "vehicle"
        ? `車番 ${edit.targetKey}`
        : (drivers.find((d) => d.employeeCode === edit.targetKey)?.driverName ??
          `社員コード ${edit.targetKey}`);

    try {
      // 1項目ずつ書く。1つ失敗しても他の項目は保存できる状態にしておく
      // (まとめて止めると、直した10項目のうち9項目が消える)。
      await stack.writer.write({
        targetKind: edit.targetKind,
        targetKey: edit.targetKey,
        field: edit.field,
        value: edit.value,
      });
      recorded.push({
        targetKind: edit.targetKind,
        targetLabel,
        targetKey: edit.targetKey,
        field: edit.field,
        fieldLabel:
          (edit.targetKind === "vehicle" ? VEHICLE_FIELD_LABELS : DRIVER_FIELD_LABELS)[
            edit.field
          ] ?? edit.field,
        beforeValue,
        afterValue: edit.value,
      });
    } catch (e) {
      failures.push({
        targetKey: edit.targetKey,
        field: edit.field,
        message: readableMessage(e),
      });
    }
  }

  // 収支表の作り直しは、書き終えてから1回だけ。
  const applied =
    recorded.length > 0
      ? await stack.applier.execute({ edits: recorded, actor })
      : { appliedYearMonths: [], applied: [], heldBackYearMonths: [] };

  return NextResponse.json({
    saved: recorded.length,
    failures,
    applied: applied.appliedYearMonths,
    heldBack: applied.heldBackYearMonths,
  });
}

/**
 * 画面に出す言葉に直す。
 * DBが返す "D1_ERROR: FOREIGN KEY constraint failed..." のような文をそのまま出すと、
 * 読んだ人が何を直せばいいのか分からないまま手が止まる。
 */
function readableMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : "";
  if (raw === "") return "保存できませんでした";
  if (/D1_ERROR|SQLITE|constraint failed/i.test(raw)) {
    return "この内容では保存できませんでした。入れた値が他のマスタにあるか確かめてください";
  }
  return raw;
}
