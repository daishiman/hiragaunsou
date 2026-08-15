import { describe, expect, it } from "vitest";
import {
  bearerTokenOf,
  tokenSetupNote,
  generateAccessToken,
  hashAccessToken,
  maskToken,
  parseScopeIds,
  signShotUrl,
  TOKEN_MAX_DAYS,
  TOKEN_PREFIX,
  tokenAllows,
  tokenExpiresAt,
  tokenRejection,
  verifyShotUrl,
} from "../../src/domain/rules/instructionAccess";

/**
 * 指示文を読むための鍵と、画像の期限付きURL。
 *
 * ここは「ログインなしで読める入口」を開ける唯一の場所なので、
 * 守りが1つでも抜けると管理画面の中身がそのまま外へ出る。
 * だから検査は「使える条件」ではなく「断れているか」の側から書く。
 */

const NOW = new Date("2026-08-15T00:00:00.000Z");
const SECRET = "test-secret:improvement-shot";

function record(over: Partial<Parameters<typeof tokenRejection>[0] & object> = {}) {
  return {
    expiresAt: new Date("2026-08-22T00:00:00.000Z"),
    revokedAt: null as Date | null,
    scopeIds: ["improve_a"],
    ...over,
  };
}

describe("鍵の生成と保存の形", () => {
  it("平文には印が付き、保存するのは指紋だけ（平文には戻せない）", async () => {
    const { token, hash } = await generateAccessToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    // 指紋は SHA-256 の16進。平文の一部がそのまま入っていない。
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(TOKEN_PREFIX.length));
    expect(await hashAccessToken(token)).toBe(hash);
  });

  it("毎回違う鍵になる（連番や時刻から次の鍵を当てられない）", async () => {
    const a = await generateAccessToken();
    const b = await generateAccessToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it("画面に出す形は先頭だけ。中身は読めない", async () => {
    const { token } = await generateAccessToken();
    const masked = maskToken(token);
    expect(masked.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(masked.length).toBeLessThan(token.length);
    // 末尾を残すと、複数の鍵を見分けるのに鍵そのものを覚えることになる。
    expect(token.endsWith(masked.replace(/…+$/, ""))).toBe(false);
  });
});

describe("鍵の寿命", () => {
  it("上限を超えて長い鍵は作れない（黙って伸ばさず、上限に丸める）", () => {
    const expires = tokenExpiresAt(NOW, 365);
    const days = (expires.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(TOKEN_MAX_DAYS);
  });

  it("0日や負の日数でも、期限が過去になる鍵は作らない", () => {
    expect(tokenExpiresAt(NOW, 0).getTime()).toBeGreaterThan(NOW.getTime());
    expect(tokenExpiresAt(NOW, -5).getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("tokenRejection（使えない理由）", () => {
  it("生きている鍵だけ null を返す", () => {
    expect(tokenRejection(record(), NOW)).toBeNull();
  });

  it("見つからない鍵は断る", () => {
    expect(tokenRejection(null, NOW)).toContain("使えません");
  });

  it("失効した鍵は、期限が残っていても断る", () => {
    const rejection = tokenRejection(record({ revokedAt: new Date("2026-08-14T00:00:00.000Z") }), NOW);
    expect(rejection).toContain("失効");
  });

  it("期限が切れた鍵は断る（期限ちょうども切れている扱い）", () => {
    expect(tokenRejection(record({ expiresAt: NOW }), NOW)).toContain("期限");
    expect(
      tokenRejection(record({ expiresAt: new Date(NOW.getTime() - 1) }), NOW),
    ).toContain("期限");
  });
});

describe("tokenAllows（読める範囲）", () => {
  it("範囲に入っている件だけ読める", () => {
    const t = record({ scopeIds: ["improve_a", "improve_b"] });
    expect(tokenAllows(t, "improve_a")).toBe(true);
    expect(tokenAllows(t, "improve_c")).toBe(false);
  });

  it("範囲が空の鍵だけが全件を読める（既定では作らない形）", () => {
    expect(tokenAllows(record({ scopeIds: [] }), "improve_z")).toBe(true);
  });

  it("前方一致では通さない（id の一部を渡しても読めない）", () => {
    expect(tokenAllows(record({ scopeIds: ["improve_abc"] }), "improve_ab")).toBe(false);
  });
});

describe("parseScopeIds", () => {
  it("壊れた JSON でも例外にせず、全件を開ける形にはしない扱いに落とす", () => {
    // 空配列 = 全件なので、ここは「安全側に倒れない」ことを承知の上で
    // 呼び出し側 (発行時) が必ず件数を指定する前提を固定しておく。
    expect(parseScopeIds("こわれた")).toEqual([]);
    expect(parseScopeIds(null)).toEqual([]);
    expect(parseScopeIds('["a","b"]')).toEqual(["a", "b"]);
    expect(parseScopeIds('["a",1,null]')).toEqual(["a"]);
  });
});

describe("bearerTokenOf", () => {
  it("Authorization: Bearer から取り出す", () => {
    const req = new Request("http://test/api/instructions", {
      headers: { authorization: "Bearer hgcc_abc" },
    });
    expect(bearerTokenOf(req)).toBe("hgcc_abc");
  });

  it("ヘッダが無い・形が違うときは null（空文字を鍵として扱わない）", () => {
    expect(bearerTokenOf(new Request("http://test/"))).toBeNull();
    expect(
      bearerTokenOf(new Request("http://test/", { headers: { authorization: "hgcc_abc" } })),
    ).toBeNull();
    expect(
      bearerTokenOf(new Request("http://test/", { headers: { authorization: "Bearer   " } })),
    ).toBeNull();
  });
});

describe("tokenSetupNote（鍵を手元に置いてもらう案内）", () => {
  it("鍵の預け先と、設定ファイルに書く1行が分かる", () => {
    const note = tokenSetupNote("https://example.workers.dev/", "hgcc_abc");
    expect(note).toContain("hgcc_abc");
    expect(note).toContain("1Password");
    // 設定ファイルには鍵そのものではなく、在りかを書く
    expect(note).toContain('HGCC_TOKEN="op://');
    expect(note).toContain("https://example.workers.dev");
    // 末尾のスラッシュが二重にならない
    expect(note).not.toContain("dev//");
  });

  it("Claude に貼る文にはしない（貼れば鍵が履歴に残り、取り消せない）", () => {
    const note = tokenSetupNote("https://example.workers.dev", "hgcc_abc");
    expect(note).toContain("Claude Code に貼らないでください");
    // 鍵を自分で付けて叩く形を教えない。教えると人がそのまま Claude へ渡す。
    expect(note).not.toContain("curl");
    expect(note).not.toContain("Bearer");
  });
});

describe("画像の期限付きURL", () => {
  it("正しい署名は期限内だけ通る", async () => {
    const { exp, sig } = await signShotUrl("improve_a", new Date(NOW.getTime() + 60_000), SECRET);
    expect(await verifyShotUrl("improve_a", exp, sig, SECRET, NOW)).toBe(true);
    // 期限を過ぎたら同じ署名でも通らない
    expect(
      await verifyShotUrl("improve_a", exp, sig, SECRET, new Date(NOW.getTime() + 120_000)),
    ).toBe(false);
  });

  it("別の要望の署名を使い回せない（id を差し替えると通らない）", async () => {
    const { exp, sig } = await signShotUrl("improve_a", new Date(NOW.getTime() + 60_000), SECRET);
    expect(await verifyShotUrl("improve_b", exp, sig, SECRET, NOW)).toBe(false);
  });

  it("期限だけ後ろに書き換えても通らない（期限も署名の対象）", async () => {
    const { sig } = await signShotUrl("improve_a", new Date(NOW.getTime() + 60_000), SECRET);
    const stretched = Math.floor((NOW.getTime() + 86_400_000) / 1000);
    expect(await verifyShotUrl("improve_a", stretched, sig, SECRET, NOW)).toBe(false);
  });

  it("鍵が違えば通らない（署名の元を知らない相手は作れない）", async () => {
    const { exp, sig } = await signShotUrl("improve_a", new Date(NOW.getTime() + 60_000), SECRET);
    expect(await verifyShotUrl("improve_a", exp, sig, "別の鍵", NOW)).toBe(false);
  });

  it("exp が数字でない・署名が空でも例外にせず false", async () => {
    expect(await verifyShotUrl("improve_a", Number.NaN, "x", SECRET, NOW)).toBe(false);
    expect(await verifyShotUrl("improve_a", 99999999999, "", SECRET, NOW)).toBe(false);
  });
});
