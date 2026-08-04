import { describe, expect, it } from "vitest";
import { signInErrorMessage } from "../../app/sign-in/signInErrorMessage";

describe("サインインエラー文言", () => {
  it("errorクエリが無いときは何も表示しない", () => {
    expect(signInErrorMessage(undefined)).toBeNull();
  });

  it("許可外ドメインは社内アカウントを促す文言になる", () => {
    expect(signInErrorMessage("unable_to_get_user_info")).toContain("社内アカウント");
  });

  it("未知のコードは汎用文言にフォールバックし、生のコードを露出しない", () => {
    const message = signInErrorMessage("some_unknown_code");
    expect(message).toBe("サインインに失敗しました。お手数ですが、もう一度お試しください。");
    expect(message).not.toContain("some_unknown_code");
  });
});
