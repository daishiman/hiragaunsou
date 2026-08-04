import { describe, expect, it } from "vitest";
import type {
  AiProvider,
  AiProviderCredentialInput,
  AiProviderCredentialRepository,
  AiProviderCredentialSecret,
  AiProviderCredentialSummary,
} from "../../src/domain/repositories/AiProviderCredentialRepository";
import {
  DeleteAiProviderCredentialUseCase,
  ListAiProviderCredentialsUseCase,
  SaveAiProviderCredentialUseCase,
} from "../../src/usecase/steps/manageAiProviderCredentials";

const SECRET = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="; // テスト専用ダミー鍵 (32byte base64)

/** D1を介さないインメモリのフェイクリポジトリ (upsertの「常に丸ごと置き換え」挙動を再現) */
function fakeRepo(): AiProviderCredentialRepository & { rows: Map<AiProvider, AiProviderCredentialInput> } {
  const rows = new Map<AiProvider, AiProviderCredentialInput>();
  return {
    rows,
    async list(): Promise<AiProviderCredentialSummary[]> {
      return [...rows.values()].map((r) => ({
        provider: r.provider,
        apiKeyLast4: r.apiKeyLast4,
        model: r.model,
        updatedAt: 0,
        updatedBy: r.updatedBy,
      }));
    },
    async findSecret(provider: AiProvider): Promise<AiProviderCredentialSecret | null> {
      const r = rows.get(provider);
      if (!r) return null;
      return { provider: r.provider, apiKeyCipher: r.apiKeyCipher, apiKeyIv: r.apiKeyIv, model: r.model };
    },
    async upsert(input: AiProviderCredentialInput): Promise<void> {
      rows.set(input.provider, input);
    },
    async remove(provider: AiProvider): Promise<void> {
      rows.delete(provider);
    },
  };
}

describe("SaveAiProviderCredentialUseCase", () => {
  it("平文APIキーを暗号化してから保存する (平文はrepoに渡さない)", async () => {
    const repo = fakeRepo();
    await new SaveAiProviderCredentialUseCase(repo, SECRET).execute({
      provider: "anthropic",
      apiKey: "sk-ant-api03-abcdefgh",
      model: "claude-sonnet-5",
      updatedBy: "user-1",
    });

    const saved = repo.rows.get("anthropic");
    expect(saved?.apiKeyCipher).toBeDefined();
    expect(saved?.apiKeyCipher).not.toContain("sk-ant-api03-abcdefgh");
    expect(saved?.apiKeyLast4).toBe("efgh");
  });

  it("既存キーがあっても上書き保存になる (部分更新はできない)", async () => {
    const repo = fakeRepo();
    const usecase = new SaveAiProviderCredentialUseCase(repo, SECRET);
    await usecase.execute({
      provider: "anthropic",
      apiKey: "sk-ant-old-key",
      model: "claude-haiku-4-5",
      updatedBy: "user-1",
    });
    await usecase.execute({
      provider: "anthropic",
      apiKey: "sk-ant-new-key",
      model: "claude-sonnet-5",
      updatedBy: "user-2",
    });

    expect(repo.rows.size).toBe(1);
    const saved = repo.rows.get("anthropic");
    expect(saved?.model).toBe("claude-sonnet-5");
    expect(saved?.updatedBy).toBe("user-2");
  });

  it("空文字のAPIキーは保存前に拒否する", async () => {
    const repo = fakeRepo();
    const usecase = new SaveAiProviderCredentialUseCase(repo, SECRET);
    await expect(
      usecase.execute({ provider: "openai", apiKey: "   ", model: "gpt-5", updatedBy: null }),
    ).rejects.toThrow();
    expect(repo.rows.size).toBe(0);
  });
});

describe("ListAiProviderCredentialsUseCase", () => {
  it("一覧に平文APIキーを含めない", async () => {
    const repo = fakeRepo();
    await new SaveAiProviderCredentialUseCase(repo, SECRET).execute({
      provider: "google",
      apiKey: "gemini-secret-key",
      model: "gemini-3-pro",
      updatedBy: "user-1",
    });

    const list = await new ListAiProviderCredentialsUseCase(repo).execute();
    expect(list).toHaveLength(1);
    expect(list[0]?.apiKeyLast4).toBe("-key");
    expect(JSON.stringify(list[0])).not.toContain("gemini-secret-key");
  });
});

describe("DeleteAiProviderCredentialUseCase", () => {
  it("指定プロバイダのキーを削除する", async () => {
    const repo = fakeRepo();
    await new SaveAiProviderCredentialUseCase(repo, SECRET).execute({
      provider: "xai",
      apiKey: "xai-secret-key",
      model: "grok-4",
      updatedBy: "user-1",
    });

    await new DeleteAiProviderCredentialUseCase(repo).execute("xai");

    expect(repo.rows.has("xai")).toBe(false);
    expect(await repo.findSecret("xai")).toBeNull();
  });
});
