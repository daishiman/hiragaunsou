import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1DeficitFactorAnalysisRepository } from "../../../src/infrastructure/db/D1DeficitFactorAnalysisRepository";
import { D1UsageLogRepository } from "../../../src/infrastructure/db/D1UsageLogRepository";
import { resolveAnthropicCredential } from "../../../src/infrastructure/ai/resolveAnthropicCredential";
import { ClaudeDeficitFactorAnalysisClient } from "../../../src/infrastructure/ai/ClaudeDeficitFactorAnalysisClient";
import { GenerateDeficitFactorAnalysisUseCase } from "../../../src/usecase/steps/generateDeficitFactorAnalysis";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";

const USAGE_KIND = "deficit_factor_analysis";
/** 月単位バッチ呼び出しのため、レポート生成(F12)より低い上限で十分。連打による暴走コストだけ抑える。 */
const RATE_LIMIT_MAX_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** GET /api/deficit-analysis?ym=YYYY-MM: キャッシュ済みの分析結果を返す(AI呼び出しなし) */
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yearMonth = new URL(request.url).searchParams.get("ym");
  if (!yearMonth) {
    return NextResponse.json({ error: "ym is required (YYYY-MM)" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const results = await new D1DeficitFactorAnalysisRepository(db).findByYearMonth(yearMonth);
  return NextResponse.json({ results });
}

/**
 * POST /api/deficit-analysis: 対象月の未分析の赤字車両をまとめてAI分析し、D1に保存する。
 * 手動ボタン起動のみ(自動実行なし)。Claude API課金が発生するためCSRF・レート制限で守る。
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

  const body = (await request.json().catch(() => ({}))) as { yearMonth?: string };
  const yearMonth = body.yearMonth;
  if (!yearMonth) {
    return NextResponse.json({ error: "yearMonth is required (YYYY-MM)" }, { status: 400 });
  }

  const db = createDb(env.DB);
  const usageLogRepo = new D1UsageLogRepository(db);

  const recentUsage = await usageLogRepo.findSince(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentCallsByUser = recentUsage.filter(
    (r) => r.kind === USAGE_KIND && r.recordedBy === session!.id,
  ).length;
  if (recentCallsByUser >= RATE_LIMIT_MAX_PER_HOUR) {
    return NextResponse.json(
      { error: "AI分析の利用上限(1時間あたり5回)に達しました。しばらくしてから再度お試しください" },
      { status: 429 },
    );
  }

  const credential = await resolveAnthropicCredential(db, env);
  if (!credential) {
    return NextResponse.json(
      { error: "AnthropicのAPIキーが未設定です。/ai-settings から登録してください" },
      { status: 500 },
    );
  }

  const useCase = new GenerateDeficitFactorAnalysisUseCase(
    new D1VehiclePlRepository(db),
    new D1DeficitFactorAnalysisRepository(db),
    new ClaudeDeficitFactorAnalysisClient({ apiKey: credential.apiKey, model: credential.model }),
    usageLogRepo,
  );

  try {
    const result = await useCase.execute({ yearMonth, requestedBy: session!.id });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI分析に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
