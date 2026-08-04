import { D1AiProviderCredentialRepository } from "../db/D1AiProviderCredentialRepository";
import { decryptApiKey } from "../security/apiKeyEncryption";
import type { Db } from "../db/client";

/**
 * /ai-settings でD1に登録されたAnthropicキーがあればそちらを優先し、無ければ
 * Cloudflare Workers Secretの env.ANTHROPIC_API_KEY にフォールバックする。
 * どちらも無い場合は呼び出し元に null を返し、Claude APIを叩く前に明確なエラーで止める。
 * (F12 AI要因分析レポート・赤字要因分析の両経路で共有する)
 */
export async function resolveAnthropicCredential(
  db: Db,
  env: CloudflareEnv,
): Promise<{ apiKey: string; model?: string } | null> {
  const secret = await new D1AiProviderCredentialRepository(db).findSecret("anthropic");
  if (secret) {
    const apiKey = await decryptApiKey(
      { cipher: secret.apiKeyCipher, iv: secret.apiKeyIv },
      env.API_KEY_ENCRYPTION_SECRET,
    );
    return { apiKey, model: secret.model };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { apiKey: env.ANTHROPIC_API_KEY };
  }
  return null;
}
