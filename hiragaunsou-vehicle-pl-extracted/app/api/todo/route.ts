import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { hasPermission } from "../../../src/domain/rules/permissions";
import { GetTodoBoardUseCase } from "../../../src/usecase/steps/getTodoBoard";
import { D1ReviewFlagRepository } from "../../../src/infrastructure/db/D1ReviewFlagRepository";
import { createDb } from "../../../src/infrastructure/db/client";

/** F2 今月のToDoボード (S1画面)。Presentation層はUseCase呼び出しのみ。 */
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
  const useCase = new GetTodoBoardUseCase(new D1ReviewFlagRepository(createDb(env.DB)));
  const response = await useCase.execute(yearMonth);
  return NextResponse.json(response);
}
