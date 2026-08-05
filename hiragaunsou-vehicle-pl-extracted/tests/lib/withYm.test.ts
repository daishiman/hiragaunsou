import { describe, expect, it } from "vitest";
import { isYmAwareHref, withYm } from "../../app/_lib/withYm";

describe("isYmAwareHref", () => {
  it("対象月で表示が変わる画面を対象とみなす", () => {
    expect(isYmAwareHref("/import")).toBe(true);
    expect(isYmAwareHref("/cleansing")).toBe(true);
    expect(isYmAwareHref("/manual-entry?step=2")).toBe(true);
    expect(isYmAwareHref("/vehicle/1111")).toBe(true);
  });

  it("対象月を持たない画面は対象外", () => {
    expect(isYmAwareHref("/")).toBe(false);
    expect(isYmAwareHref("/dashboard")).toBe(false);
    expect(isYmAwareHref("/profile")).toBe(false);
    expect(isYmAwareHref("/admin/import-batches")).toBe(false);
    expect(isYmAwareHref("/logic")).toBe(false);
  });

  it("前方一致だけで別画面を巻き込まない", () => {
    expect(isYmAwareHref("/importance")).toBe(false);
  });
});

describe("withYm", () => {
  it("ymが無ければhrefをそのまま返す", () => {
    expect(withYm("/cleansing", null)).toBe("/cleansing");
    expect(withYm("/cleansing", undefined)).toBe("/cleansing");
    expect(withYm("/cleansing", "")).toBe("/cleansing");
  });

  it("クエリの無いhrefには ? で付ける", () => {
    expect(withYm("/cleansing", "2026-05")).toBe("/cleansing?ym=2026-05");
  });

  it("既存クエリのあるhrefには & で付ける", () => {
    expect(withYm("/import?step=2", "2026-05")).toBe("/import?step=2&ym=2026-05");
  });

  it("href側が既にymを持つ場合は上書きしない(リンクの明示指定を優先)", () => {
    expect(withYm("/import?ym=2026-01", "2026-05")).toBe("/import?ym=2026-01");
    expect(withYm("/import?step=2&ym=2026-01", "2026-05")).toBe("/import?step=2&ym=2026-01");
  });

  it("ymを読まない画面には付けない(URLを汚さない)", () => {
    expect(withYm("/dashboard", "2026-05")).toBe("/dashboard");
    expect(withYm("/admin/users", "2026-05")).toBe("/admin/users");
  });

  it("YYYY-MM形式でない値は無視する", () => {
    expect(withYm("/cleansing", "2026-13")).toBe("/cleansing");
    expect(withYm("/cleansing", "2026")).toBe("/cleansing");
    expect(withYm("/cleansing", "'; drop table")).toBe("/cleansing");
  });
});
