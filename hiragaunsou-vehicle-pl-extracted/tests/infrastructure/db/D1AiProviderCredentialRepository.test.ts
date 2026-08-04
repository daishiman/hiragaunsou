import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "./testDbHelper";
import { D1AiProviderCredentialRepository } from "../../../src/infrastructure/db/D1AiProviderCredentialRepository";
import type { AiProviderCredentialInput } from "../../../src/domain/repositories/AiProviderCredentialRepository";

describe("D1AiProviderCredentialRepository", () => {
  let ctx: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    ctx = createTestDb();
  });

  const input: AiProviderCredentialInput = {
    provider: "anthropic",
    apiKeyCipher: "cipher-bytes",
    apiKeyIv: "iv-bytes",
    apiKeyLast4: "abcd",
    model: "claude-haiku-4-5",
    updatedBy: null,
  };

  describe("list", () => {
    it("登録が無ければ空配列を返す", async () => {
      const repo = new D1AiProviderCredentialRepository(ctx.db);
      expect(await repo.list()).toEqual([]);
    });

    it("平文キーを含まないサマリを返す", async () => {
      const repo = new D1AiProviderCredentialRepository(ctx.db);
      await repo.upsert(input);
      const list = await repo.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        provider: "anthropic",
        apiKeyLast4: "abcd",
        model: "claude-haiku-4-5",
      });
      expect(list[0]).not.toHaveProperty("apiKeyCipher");
      expect(list[0]).not.toHaveProperty("apiKeyIv");
      expect(typeof list[0]?.updatedAt).toBe("number");
    });
  });

  describe("findSecret", () => {
    it("未登録のproviderはnullを返す", async () => {
      const repo = new D1AiProviderCredentialRepository(ctx.db);
      expect(await repo.findSecret("anthropic")).toBeNull();
    });

    it("登録済みなら暗号文一式を返す", async () => {
      const repo = new D1AiProviderCredentialRepository(ctx.db);
      await repo.upsert(input);
      const secret = await repo.findSecret("anthropic");
      expect(secret).toEqual({
        provider: "anthropic",
        apiKeyCipher: "cipher-bytes",
        apiKeyIv: "iv-bytes",
        model: "claude-haiku-4-5",
      });
    });

    it("別providerの秘密は取得できない", async () => {
      const repo = new D1AiProviderCredentialRepository(ctx.db);
      await repo.upsert(input);
      expect(await repo.findSecret("openai")).toBeNull();
    });
  });

  describe("upsert", () => {
    it("同一providerへの再登録は部分更新ではなく丸ごと置き換える", async () => {
      const repo = new D1AiProviderCredentialRepository(ctx.db);
      await repo.upsert(input);
      await repo.upsert({
        ...input,
        apiKeyCipher: "new-cipher",
        apiKeyIv: "new-iv",
        apiKeyLast4: "wxyz",
        model: "claude-opus-4",
      });
      const secret = await repo.findSecret("anthropic");
      expect(secret).toEqual({
        provider: "anthropic",
        apiKeyCipher: "new-cipher",
        apiKeyIv: "new-iv",
        model: "claude-opus-4",
      });
      const rows = ctx.sqlite.prepare("SELECT * FROM ai_provider_credential").all();
      expect(rows).toHaveLength(1);
    });
  });

  describe("remove", () => {
    it("登録済みproviderを削除する", async () => {
      const repo = new D1AiProviderCredentialRepository(ctx.db);
      await repo.upsert(input);
      await repo.remove("anthropic");
      expect(await repo.findSecret("anthropic")).toBeNull();
      expect(await repo.list()).toEqual([]);
    });

    it("未登録のproviderを削除してもエラーにならない", async () => {
      const repo = new D1AiProviderCredentialRepository(ctx.db);
      await expect(repo.remove("google")).resolves.toBeUndefined();
    });
  });
});
