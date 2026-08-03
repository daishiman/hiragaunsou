import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1UsageLogRepository } from "../../../src/infrastructure/db/D1UsageLogRepository";
import { ClaudeFactorAnalysisClient } from "../../../src/infrastructure/ai/ClaudeFactorAnalysisClient";
import { GenerateFactorAnalysisReportUseCase } from "../../../src/usecase/steps/generateFactorAnalysisReport";
import { recentYearMonths } from "../../_lib/yearMonth";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";

const USAGE_KIND = "factor_analysis_report";
/** 1ユーザーあたりの上限。Claude API課金が発生するエンドポイントのため、connタブ連打等の暴走コストを抑える。 */
const RATE_LIMIT_MAX_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * F12 AI要因分析レポート生成 (S10画面)。
 * 生成には時間がかかる想定のため、確定応答のみ返しクライアント側で進捗表示する。
 * レポートは永続化テーブルを持たないため(スコープ外)、リクエストの都度Claudeを呼び出して生成する。
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "report_settings")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { targetYearMonth?: string };
  const targetYearMonth = body.targetYearMonth;
  if (!targetYearMonth) {
    return NextResponse.json({ error: "targetYearMonth is required (YYYY-MM)" }, { status: 400 });
  }

  const db = createDb(env.DB);
  const usageLogRepo = new D1UsageLogRepository(db);

  const recentUsage = await usageLogRepo.findSince(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentCallsByUser = recentUsage.filter(
    (r) => r.kind === USAGE_KIND && r.recordedBy === session!.id,
  ).length;
  if (recentCallsByUser >= RATE_LIMIT_MAX_PER_HOUR) {
    return NextResponse.json(
      { error: "レポート生成の利用上限(1時間あたり5回)に達しました。しばらくしてから再度お試しください" },
      { status: 429 },
    );
  }

  const useCase = new GenerateFactorAnalysisReportUseCase(
    new D1VehiclePlRepository(db),
    new ClaudeFactorAnalysisClient({ apiKey: env.ANTHROPIC_API_KEY }),
    usageLogRepo,
  );

  try {
    const result = await useCase.execute({
      targetYearMonth,
      compareYearMonths: recentYearMonths(targetYearMonth, 3),
      requestedBy: session!.id,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "レポート生成に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
