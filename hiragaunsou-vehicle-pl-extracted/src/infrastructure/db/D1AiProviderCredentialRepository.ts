import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { aiProviderCredential } from "./schema";
import type {
  AiProvider,
  AiProviderCredentialInput,
  AiProviderCredentialRepository,
  AiProviderCredentialSecret,
  AiProviderCredentialSummary,
} from "../../domain/repositories/AiProviderCredentialRepository";

/** D1(Drizzle)によるAiProviderCredentialRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1AiProviderCredentialRepository implements AiProviderCredentialRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<AiProviderCredentialSummary[]> {
    const rows = await this.db.select().from(aiProviderCredential);
    return rows.map((r) => ({
      provider: r.provider as AiProvider,
      apiKeyLast4: r.apiKeyLast4,
      model: r.model,
      updatedAt: r.updatedAt.getTime(),
      updatedBy: r.updatedBy,
    }));
  }

  async findSecret(provider: AiProvider): Promise<AiProviderCredentialSecret | null> {
    const rows = await this.db
      .select()
      .from(aiProviderCredential)
      .where(eq(aiProviderCredential.provider, provider))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      provider: row.provider as AiProvider,
      apiKeyCipher: row.apiKeyCipher,
      apiKeyIv: row.apiKeyIv,
      model: row.model,
    };
  }

  async upsert(input: AiProviderCredentialInput): Promise<void> {
    await this.db
      .insert(aiProviderCredential)
      .values({
        provider: input.provider,
        apiKeyCipher: input.apiKeyCipher,
        apiKeyIv: input.apiKeyIv,
        apiKeyLast4: input.apiKeyLast4,
        model: input.model,
        updatedAt: new Date(),
        updatedBy: input.updatedBy,
      })
      .onConflictDoUpdate({
        target: aiProviderCredential.provider,
        set: {
          apiKeyCipher: input.apiKeyCipher,
          apiKeyIv: input.apiKeyIv,
          apiKeyLast4: input.apiKeyLast4,
          model: input.model,
          updatedAt: new Date(),
          updatedBy: input.updatedBy,
        },
      });
  }

  async remove(provider: AiProvider): Promise<void> {
    await this.db.delete(aiProviderCredential).where(eq(aiProviderCredential.provider, provider));
  }
}
