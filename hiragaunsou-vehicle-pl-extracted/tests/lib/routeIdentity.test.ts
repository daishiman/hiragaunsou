import { describe, expect, it } from "vitest";
import {
  isAcceptableScreenPath,
  routeIdentityOf,
  UNKNOWN_SCREEN_LABEL,
} from "../../app/_lib/routeIdentity";

describe("要望を束ねる単位の決め方", () => {
  it("クエリと # を落とす (対象月や検索語を管理者の一覧へ持ち込まない)", () => {
    expect(routeIdentityOf("/grid?ym=2026-05#top").path).toBe("/grid");
  });

  it("末尾のスラッシュをそろえる", () => {
    expect(routeIdentityOf("/grid/").path).toBe("/grid");
    expect(routeIdentityOf("/").path).toBe("/");
  });

  it("別サイトへ読み替えられる形は受け取らない", () => {
    expect(routeIdentityOf("//example.com/steal").path).toBe("/");
    expect(routeIdentityOf("https://example.com/steal").path).toBe("/");
  });

  it("車番が違っても同じ画面として数える", () => {
    const a = routeIdentityOf("/vehicle/1177");
    const b = routeIdentityOf("/vehicle/2244?ym=2026-05");
    expect(a.routePattern).toBe("/vehicle/[vehicleNo]");
    expect(b.routePattern).toBe(a.routePattern);
    // 実URLは残す。どの車両を見ていたかが再現の手がかりになる
    expect(a.path).toBe("/vehicle/1177");
    expect(b.path).toBe("/vehicle/2244");
  });

  it("要望の詳細画面そのものも1つの単位に束ねる", () => {
    expect(routeIdentityOf("/admin/improvements/improve_abc").routePattern).toBe(
      "/admin/improvements/[id]",
    );
  });

  it("動的でない画面は実URLがそのまま単位になる", () => {
    const r = routeIdentityOf("/grid");
    expect(r.routePattern).toBe("/grid");
  });

  it("呼び名はサイドバーと同じ画面台帳から引く", () => {
    expect(routeIdentityOf("/vehicle/1177").label).toBe("車両1台の明細");
    expect(routeIdentityOf("/admin/improvements").label).toBe("改善要望");
  });

  it("台帳に無いパスでも名前の無い行を作らない", () => {
    expect(routeIdentityOf("/not-a-screen").label).toBe(UNKNOWN_SCREEN_LABEL);
  });
});

describe("画面パスとして受け取ってよい形", () => {
  it("/ で始まる文字列だけを通す", () => {
    expect(isAcceptableScreenPath("/grid")).toBe(true);
    expect(isAcceptableScreenPath("grid")).toBe(false);
    expect(isAcceptableScreenPath("//example.com")).toBe(false);
    expect(isAcceptableScreenPath("")).toBe(false);
    expect(isAcceptableScreenPath(undefined)).toBe(false);
    expect(isAcceptableScreenPath(123)).toBe(false);
  });

  it("極端に長いものは通さない", () => {
    expect(isAcceptableScreenPath("/" + "a".repeat(300))).toBe(false);
  });
});
