import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { hasPermission } from "../../../src/domain/rules/permissions";
import { GetMonthlyGridUseCase } from "../../../src/usecase/steps/getMonthlyGrid";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { createDb } from "../../../src/infrastructure/db/client";

/** F1 月次収支グリッド (S2画面): 車両×51列。Presentation層はUseCase呼び出しのみ、業務ロジックは持たない。 */
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session || !hasPermission(session.role, "view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yearMonth = new URL(request.url).searchParams.get("yearMonth");
  if (!yearMonth) {
    return NextResponse.json({ error: "yearMonth is required (YYYY-MM)" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const useCase = new GetMonthlyGridUseCase(
    new D1VehiclePlRepository(db),
    new D1ReviewFlagRepository(db),
  );
  const response = await useCase.execute(yearMonth);
  return NextResponse.json(response);
}
