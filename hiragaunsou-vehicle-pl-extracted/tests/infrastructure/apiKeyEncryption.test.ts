import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey } from "../../src/infrastructure/security/apiKeyEncryption";

/**
 * AI連携用APIキーの暗号化/復号。D1には暗号文しか残らないことと、
 * 同じ平文でも呼ぶたびにIVが変わって暗号文が変わることを確認する。
 */
describe("apiKeyEncryption", () => {
  const SECRET = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="; // 32byte base64 (テスト専用ダミー)

  it("暗号化した値を同じ鍵で復号すると平文に戻る", async () => {
    const plain = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
    const encrypted = await encryptApiKey(plain, SECRET);

    expect(encrypted.cipher).not.toContain(plain);
    expect(encrypted.last4).toBe("wxyz");

    const decrypted = await decryptApiKey(encrypted, SECRET);
    expect(decrypted).toBe(plain);
  });

  it("同じ平文でも呼ぶたびにIV・暗号文が変わる (レインボーテーブル対策)", async () => {
    const plain = "sk-ant-api03-same-key-twice";
    const first = await encryptApiKey(plain, SECRET);
    const second = await encryptApiKey(plain, SECRET);

    expect(first.iv).not.toBe(second.iv);
    expect(first.cipher).not.toBe(second.cipher);
  });

  it("異なる鍵で復号しようとすると失敗する (鍵が漏れない限り復元できない)", async () => {
    const OTHER_SECRET = "OTk4NzY1NDMyMTA5ODc2NTQzMjEwOTg3NjU0MzIxMDk=";
    const encrypted = await encryptApiKey("sk-ant-secret", SECRET);

    await expect(decryptApiKey(encrypted, OTHER_SECRET)).rejects.toThrow();
  });

  it("32byteでない鍵はエラーにする (誤設定を早期に検知する)", async () => {
    await expect(encryptApiKey("value", "dGVzdA==")).rejects.toThrow();
  });
});
