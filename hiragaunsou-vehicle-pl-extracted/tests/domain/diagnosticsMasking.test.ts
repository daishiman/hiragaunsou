import { describe, expect, it } from "vitest";
import {
  DIAGNOSTICS_UNAVAILABLE,
  elementIdentity,
  maskSensitive,
  maskUrl,
} from "../../src/domain/rules/diagnosticsMasking";

/**
 * 診断情報のマスク。
 *
 * ここは会社境界と同じ重さで守る。送った人は「何が一緒に送られたか」を
 * 中身まで見ていない。見ていないものが漏れると、後から取り消せない。
 *
 * したがって検査の観点は2つ。
 *  1. 秘密が「素のまま残っていない」こと (含まれていないことを直接確かめる)
 *  2. 伏せた跡が見えること (伏せたのか元から無かったのかを、読む人が区別できる)
 */
describe("maskSensitive", () => {
  it("JWT 形式のトークンを伏せる", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const masked = maskSensitive(`失敗: token=${jwt}`);
    expect(masked).not.toContain(jwt);
    expect(masked).toContain("[マスク:");
  });

  it("Authorization ヘッダの中身を伏せる", () => {
    const masked = maskSensitive("Authorization: Bearer abcdef1234567890XYZ");
    expect(masked).not.toContain("abcdef1234567890XYZ");
    expect(masked).toContain("[マスク:");
  });

  it("Cookie のセッション値を伏せる", () => {
    const masked = maskSensitive("cookie: better-auth.session_token=Zm9vYmFyYmF6cXV4MTIzNDU2");
    expect(masked).not.toContain("Zm9vYmFyYmF6cXV4MTIzNDU2");
  });

  it("メールアドレスを伏せる", () => {
    const masked = maskSensitive("送信者 h_atsushi@hiragaunsou.co.jp が失敗しました");
    expect(masked).not.toContain("h_atsushi@hiragaunsou.co.jp");
    expect(masked).toContain("[マスク: メール]");
  });

  it("カード番号らしい並びを伏せる", () => {
    const masked = maskSensitive("番号 4111-1111-1111-1111 が不正です");
    expect(masked).not.toContain("4111-1111-1111-1111");
  });

  it("13桁のミリ秒時刻は伏せない（いつ起きたかが消えると再現できない）", () => {
    const masked = maskSensitive("at=1766000000000 で失敗");
    expect(masked).toContain("1766000000000");
  });

  it("鍵の名前で判断して値を伏せる（形が読めない値でも守る）", () => {
    const masked = maskSensitive('{"password":"harunoumi2026","vehicleNo":"1177"}');
    expect(masked).not.toContain("harunoumi2026");
    // 業務の値まで伏せない。伏せすぎると原因が読めなくなる。
    expect(masked).toContain("1177");
  });

  it("api_key / client_secret / refresh_token など別名でも伏せる", () => {
    for (const key of ["api_key", "clientSecret", "refresh_token", "apiKey", "accessToken"]) {
      const masked = maskSensitive(`${key}=SUPERSECRETVALUE123`);
      expect(masked, key).not.toContain("SUPERSECRETVALUE123");
    }
  });

  it("長さを切り詰める（1件で上限を食い潰さない）", () => {
    const masked = maskSensitive("あ".repeat(1000), 100);
    expect(masked.startsWith("あ".repeat(100))).toBe(true);
    // 切ったことを書き添える。黙って切ると「そこで終わっていた」と読まれる。
    expect(masked).toContain("以下900文字を省略");
    expect(masked.length).toBeLessThan(130);
  });

  it("空の値は空のまま返す（取得不可の印は呼び出し側で入れる）", () => {
    expect(maskSensitive("")).toBe("");
    expect(maskSensitive(undefined as unknown as string)).toBe("");
    expect(DIAGNOSTICS_UNAVAILABLE).toBe("取得不可");
  });
});

describe("maskUrl", () => {
  it("クエリの値は伏せ、鍵の名前は残す（どの条件で見ていたかは残す）", () => {
    const masked = maskUrl("https://example.com/vehicle/1177?token=abcdef123456&ym=2026-05");
    expect(masked).not.toContain("abcdef123456");
    expect(masked).toContain("token=");
    expect(masked).toContain("ym=");
    expect(masked).toContain("/vehicle/1177");
  });

  it("URLとして読めない値でもマスクを通して返す", () => {
    expect(maskUrl("not a url with mail@example.com")).not.toContain("mail@example.com");
  });
});

describe("elementIdentity", () => {
  it("入力された値は含めない（どの欄かは分かるが、何を打ったかは分からない）", () => {
    const el = {
      tagName: "INPUT",
      id: "vehicle_no",
      className: "input input-lg",
      getAttribute: (name: string) =>
        name === "data-testid" ? "vehicle-input" : name === "aria-label" ? "車両番号" : null,
      value: "1177",
    };
    const identity = elementIdentity(el as unknown as Element);
    expect(identity).toContain("input");
    expect(identity).toContain("#vehicle_no");
    expect(identity).toContain("vehicle-input");
    expect(identity).not.toContain("1177");
  });
});
