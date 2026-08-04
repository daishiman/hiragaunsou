/**
 * AI分析(要因分析レポート等)に使う外部プロバイダのAPIキー管理。
 * 平文APIキーはこの層より上(Domain/Usecase)には一切出さない。
 * 一覧・削除は誰でも呼べる形にせず、admin権限(manage_api_keys)を持つRoute Handlerからのみ呼ぶこと。
 */
export type AiProvider = "anthropic" | "openai" | "google" | "xai";

export const AI_PROVIDERS: readonly AiProvider[] = ["anthropic", "openai", "google", "xai"];

/** 一覧表示用。暗号文・平文どちらのAPIキーも含めない。 */
export interface AiProviderCredentialSummary {
  provider: AiProvider;
  apiKeyLast4: string;
  model: string;
  updatedAt: number;
  updatedBy: string | null;
}

/** 復号に必要な暗号文一式。AI呼び出し直前にのみ取得し、レスポンスに含めない。 */
export interface AiProviderCredentialSecret {
  provider: AiProvider;
  apiKeyCipher: string;
  apiKeyIv: string;
  model: string;
}

export interface AiProviderCredentialInput {
  provider: AiProvider;
  apiKeyCipher: string;
  apiKeyIv: string;
  apiKeyLast4: string;
  model: string;
  updatedBy: string | null;
}

export interface AiProviderCredentialRepository {
  list(): Promise<AiProviderCredentialSummary[]>;
  findSecret(provider: AiProvider): Promise<AiProviderCredentialSecret | null>;
  /** provider単位で1件のみ保持する。既存があっても常に丸ごと置き換える(部分更新はしない)。 */
  upsert(input: AiProviderCredentialInput): Promise<void>;
  remove(provider: AiProvider): Promise<void>;
}
