import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { ConfirmMonthlyPlUseCase } from "../../../src/usecase/steps/confirmMonthlyPl";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";

/** 業務フロー STEP8: 月次収支表の確定 / 確定解除 */
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
    confirmed?: boolean;
  } | null;
  if (!body?.yearMonth || typeof body.confirmed !== "boolean") {
    return NextResponse.json({ error: "yearMonth and confirmed are required" }, { status: 400 });
  }

  try {
    const db = createDb(env.DB);
    const useCase = new ConfirmMonthlyPlUseCase(
      new D1VehiclePlRepository(db),
      new D1ReviewFlagRepository(db),
    );
    return NextResponse.json(await useCase.execute(body.yearMonth, body.confirmed));
  } catch (e) {
    const message = e instanceof Error ? e.message : "確定できませんでした";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
