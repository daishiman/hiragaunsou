import { describe, expect, it } from "vitest";
import {
  DIAGNOSTICS_LIMITS,
  DIAGNOSTICS_MAX_BYTES,
  byteLengthOf,
  occurredAtOf,
  sanitizeClientDiagnostics,
  sourceFileOf,
} from "../../src/domain/rules/diagnostics";

/**
 * ブラウザから届いた診断情報の受け入れ。
 *
 * ここに来る値は「本人が確かめていないもの」なので、形も量も信用しない。
 * 検査するのは3つ。
 *  1. 壊れた値でも落ちない (診断情報の不備で要望そのものが届かなくなる方が損)
 *  2. 秘密は必ずマスクを通る (どの入口から入れても素で残らない)
 *  3. 上限を超えたら古い順に捨て、捨てたことを書き残す
 */
describe("sanitizeClientDiagnostics", () => {
  it("何も渡されなくても形の揃ったものを返す", () => {
    const d = sanitizeClientDiagnostics(undefined);
    expect(d.version).toBe(1);
    expect(d.console).toEqual([]);
    expect(d.errors).toEqual([]);
    expect(d.environment.browser).toBe("取得不可");
    expect(d.performance.pageLoadMs).toBe("取得不可");
  });

  it("壊れた形（配列でない・数値でない）でも例外を投げない", () => {
    const d = sanitizeClientDiagnostics({
      console: "こわれている",
      errors: 3,
      environment: null,
      performance: [],
      breadcrumbs: [{ kind: 42, target: null }],
    });
    expect(d.console).toEqual([]);
    expect(d.errors).toEqual([]);
    expect(d.breadcrumbs[0]?.kind).toBe("click");
    expect(d.breadcrumbs[0]?.target).toBe("取得不可");
  });

  it("どの入口から入れても秘密はマスクを通る", () => {
    const secret = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.Zm9vYmFyYmF6cXV4MTIzNA";
    const d = sanitizeClientDiagnostics({
      console: [{ level: "error", message: `失敗 ${secret}`, at: "12:00:00" }],
      errors: [{ kind: "uncaught", message: `boom ${secret}`, stack: secret, at: "12:00:00" }],
      network: [{ method: "GET", url: `/api/x?token=${secret}`, responseExcerpt: secret }],
      breadcrumbs: [{ kind: "click", target: `button[aria-label=${secret}]` }],
      environment: { userAgent: `UA mail@example.com` },
    });
    const dump = JSON.stringify(d);
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain("mail@example.com");
  });

  it("件数の上限を超えた分は古い方から捨てる（新しい方を残す）", () => {
    const console_ = Array.from({ length: DIAGNOSTICS_LIMITS.console + 10 }, (_, i) => ({
      level: "warn",
      message: `msg-${i}`,
      at: "12:00:00",
    }));
    const d = sanitizeClientDiagnostics({ console: console_ });
    expect(d.console).toHaveLength(DIAGNOSTICS_LIMITS.console);
    // 押した直後に出たもの (最後の1件) が残っていることが肝心。
    expect(d.console.at(-1)?.message).toBe(`msg-${console_.length - 1}`);
  });

  it("全体が上限を超えたら捨てて、捨てたことを書き残す", () => {
    const long = "あ".repeat(400);
    const d = sanitizeClientDiagnostics({
      breadcrumbs: Array.from({ length: 30 }, () => ({ kind: "click", target: long })),
      api: Array.from({ length: 20 }, () => ({ method: "GET", url: `/api/${long}` })),
      console: Array.from({ length: 30 }, () => ({ level: "warn", message: long, at: "12:00" })),
      errors: Array.from({ length: 10 }, () => ({ kind: "uncaught", message: long, at: "12:00" })),
    });
    expect(byteLengthOf(d)).toBeLessThanOrEqual(DIAGNOSTICS_MAX_BYTES);
    expect(d.notes.join("")).toContain("古い順に捨てました");
    // 例外は最後まで残す (それ自体が答えであることが多い)。
    expect(d.errors.length).toBeGreaterThan(0);
  });

  it("console は error と warn だけ残す（info / debug は捨てる）", () => {
    const d = sanitizeClientDiagnostics({
      console: [
        { level: "debug", message: "x" },
        { level: "info", message: "y" },
        { level: "warn", message: "z" },
        { level: "error", message: "w" },
      ],
    });
    expect(d.console.map((c) => c.level)).toEqual(["warn", "error"]);
  });

  it("うまくいった通信は、ブラウザが送ってきても3秒未満なら捨てる", () => {
    // 控える側を差し替えられても、保存する手前でもう一度ふるいにかける。
    const d = sanitizeClientDiagnostics({
      slowApi: [
        { method: "GET", url: "/api/fast", durationMs: 120, status: 200 },
        { method: "GET", url: "/api/slow", durationMs: 4200, status: 200 },
      ],
    });
    expect(d.slowApi.map((n) => n.url)).toEqual(["/api/slow"]);
  });
});

describe("occurredAtOf", () => {
  it("UTC と JST の両方を持つ（時差の読み替えを人にさせない）", () => {
    const at = occurredAtOf(new Date("2026-08-15T15:30:00.000Z"));
    expect(at.utc).toBe("2026-08-15T15:30:00.000Z");
    expect(at.jst).toBe("2026-08-16 00:30:00 JST");
  });
});

describe("sourceFileOf", () => {
  it("route pattern から直すファイルを引く", () => {
    expect(sourceFileOf("/")).toBe("app/(app)/page.tsx");
    expect(sourceFileOf("/grid")).toBe("app/(app)/grid/page.tsx");
    expect(sourceFileOf("/vehicle/[vehicleNo]")).toBe("app/(app)/vehicle/[vehicleNo]/page.tsx");
  });

  it("道筋として読めない値は取得不可にする", () => {
    expect(sourceFileOf("その他の画面")).toBe("取得不可");
  });
});
