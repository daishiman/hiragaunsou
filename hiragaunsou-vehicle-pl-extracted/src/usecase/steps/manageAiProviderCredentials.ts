import type {
  AiProvider,
  AiProviderCredentialRepository,
  AiProviderCredentialSummary,
} from "../../domain/repositories/AiProviderCredentialRepository";
import { encryptApiKey } from "../../infrastructure/security/apiKeyEncryption";

/**
 * AI連携APIキー管理画面(admin専用)のユースケース。
 *
 * 編集は常に上書き保存のみ: 既存レコードの一部フィールドだけを更新する手段は用意しない
 * (キーを変えずにモデルだけ変える場合も、画面側でキーの再入力を必須にする)。
 * 一覧・保存・削除のいずれも平文APIキーをレスポンスへ含めてはならない。
 */
export class ListAiProviderCredentialsUseCase {
  constructor(private readonly repo: AiProviderCredentialRepository) {}

  async execute(): Promise<AiProviderCredentialSummary[]> {
    return this.repo.list();
  }
}

export interface SaveAiProviderCredentialInput {
  provider: AiProvider;
  apiKey: string;
  model: string;
  updatedBy: string | null;
}

export class SaveAiProviderCredentialUseCase {
  constructor(
    private readonly repo: AiProviderCredentialRepository,
    private readonly encryptionSecret: string,
  ) {}

  async execute(input: SaveAiProviderCredentialInput): Promise<void> {
    const trimmed = input.apiKey.trim();
    if (trimmed.length === 0) {
      throw new Error("APIキーを入力してください");
    }

    const encrypted = await encryptApiKey(trimmed, this.encryptionSecret);
    await this.repo.upsert({
      provider: input.provider,
      apiKeyCipher: encrypted.cipher,
      apiKeyIv: encrypted.iv,
      apiKeyLast4: encrypted.last4,
      model: input.model,
      updatedBy: input.updatedBy,
    });
  }
}

export class DeleteAiProviderCredentialUseCase {
  constructor(private readonly repo: AiProviderCredentialRepository) {}

  async execute(provider: AiProvider): Promise<void> {
    await this.repo.remove(provider);
  }
}
