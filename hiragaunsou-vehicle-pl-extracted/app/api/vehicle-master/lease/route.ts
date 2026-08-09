import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehicleMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { masterChangeStack } from "../../../_lib/masterChangeStack";
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

    // 直す前の値を控える。控えないと履歴に残らず、元に戻せない。
    const before = (await vehicleMasterRepo.findAllActive()).find(
      (v) => v.vehicleNo === body.vehicleNo,
    );

    await vehicleMasterRepo.updateLeaseInstallment(
      body.vehicleNo,
      toAmount(body.lease),
      toAmount(body.installment),
    );

    // まだ締めていない月には自動で反映し、確定済みの月は据え置く。
    // 車両マスタは全期間に効くので、月を絞らない。
    const actor = { id: session!.id, name: session!.name ?? "" };
    const applied = await masterChangeStack(db, actor).applier.execute({
      edits: [
        {
          targetKind: "vehicle" as const,
          targetKey: body.vehicleNo,
          targetLabel: `車番 ${body.vehicleNo}`,
          field: "lease",
          fieldLabel: "リース料",
          beforeValue: before ? String(before.lease) : null,
          afterValue: String(toAmount(body.lease)),
        },
        {
          targetKind: "vehicle" as const,
          targetKey: body.vehicleNo,
          targetLabel: `車番 ${body.vehicleNo}`,
          field: "installment",
          fieldLabel: "割賦の支払",
          beforeValue: before ? String(before.installment) : null,
          afterValue: String(toAmount(body.installment)),
        },
      ],
      actor,
    });

    return NextResponse.json({
      yearMonth: body.yearMonth,
      vehicleNo: body.vehicleNo,
      applied: applied.appliedYearMonths,
      heldBack: applied.heldBackYearMonths,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "リース料・割賦支払額の更新に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
