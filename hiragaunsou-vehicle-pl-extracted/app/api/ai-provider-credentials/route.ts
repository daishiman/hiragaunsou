import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1AiProviderCredentialRepository } from "../../../src/infrastructure/db/D1AiProviderCredentialRepository";
import {
  DeleteAiProviderCredentialUseCase,
  ListAiProviderCredentialsUseCase,
  SaveAiProviderCredentialUseCase,
} from "../../../src/usecase/steps/manageAiProviderCredentials";
import { AI_PROVIDERS, type AiProvider } from "../../../src/domain/repositories/AiProviderCredentialRepository";
import { findModelOption } from "../../../src/domain/rules/aiModelCatalog";
import { isSameOriginRequest } from "../../_lib/assertSameOrigin";

/**
 * AI連携APIキー管理 (admin専用、/ai-settings 画面のバックエンド)。
 *
 * ★ このAPIは平文APIキーを絶対にレスポンスへ含めない。GETは末尾4桁のマスク値のみ返し、
 *   POSTは保存結果(成否)のみを返す。復号は AI呼び出しの直前・サーバー側でのみ行う想定であり、
 *   ここでは暗号化して保存する以上のことはしない。
 */

function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_api_keys")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const credentials = await new ListAiProviderCredentialsUseCase(
    new D1AiProviderCredentialRepository(db),
  ).execute();

  return NextResponse.json({ credentials });
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_api_keys")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    provider?: string;
    apiKey?: string;
    model?: string;
  } | null;

  if (!isAiProvider(body?.provider)) {
    return NextResponse.json({ error: "provider is invalid" }, { status: 400 });
  }
  if (!body?.apiKey || typeof body.apiKey !== "string") {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }
  if (!body.model || !findModelOption(body.provider, body.model)) {
    return NextResponse.json({ error: "model is invalid" }, { status: 400 });
  }

  try {
    const db = createDb(env.DB);
    await new SaveAiProviderCredentialUseCase(
      new D1AiProviderCredentialRepository(db),
      env.API_KEY_ENCRYPTION_SECRET,
    ).execute({
      provider: body.provider,
      apiKey: body.apiKey,
      model: body.model,
      updatedBy: session!.id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "APIキーの保存に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_api_keys")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const provider = new URL(request.url).searchParams.get("provider");
  if (!isAiProvider(provider)) {
    return NextResponse.json({ error: "provider is invalid" }, { status: 400 });
  }

  const db = createDb(env.DB);
  await new DeleteAiProviderCredentialUseCase(new D1AiProviderCredentialRepository(db)).execute(
    provider,
  );
  return NextResponse.json({ ok: true });
}
