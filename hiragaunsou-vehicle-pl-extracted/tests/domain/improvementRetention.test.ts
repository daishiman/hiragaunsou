import { describe, expect, it } from "vitest";
import {
  RETENTION_DAYS_DEFAULT,
  RETENTION_DAYS_MAX,
  RETENTION_DAYS_MIN,
  retentionCutoff,
  retentionDaysOf,
  retentionNoticeText,
  retentionSweepNote,
} from "../../src/domain/rules/improvementRetention";

/**
 * 画面の写しと診断情報を、いつまで持つか。
 *
 * ここで固定したいのは「設定を間違えても危ない方へ倒れない」こと。
 * 保存期間の設定は滅多に触らないため、書き間違いに誰も気づかない。
 * 読めない値で 0日 (=届いた瞬間に消える) になる方が、既定に戻るより困る。
 */
describe("retentionDaysOf", () => {
  it("未設定なら既定の90日", () => {
    expect(retentionDaysOf(undefined)).toBe(90);
    expect(retentionDaysOf(null)).toBe(RETENTION_DAYS_DEFAULT);
    expect(retentionDaysOf("")).toBe(RETENTION_DAYS_DEFAULT);
    expect(retentionDaysOf("   ")).toBe(RETENTION_DAYS_DEFAULT);
  });

  it("短くしたいときは、その日数をそのまま使う", () => {
    expect(retentionDaysOf("30")).toBe(30);
    expect(retentionDaysOf(String(RETENTION_DAYS_MIN))).toBe(RETENTION_DAYS_MIN);
    expect(retentionDaysOf(String(RETENTION_DAYS_MAX))).toBe(RETENTION_DAYS_MAX);
  });

  it("小数は日単位に切り捨てる", () => {
    expect(retentionDaysOf("30.9")).toBe(30);
  });

  it("短すぎる・長すぎる・読めない値は既定に倒す（0日で消えたりしない）", () => {
    expect(retentionDaysOf("0")).toBe(RETENTION_DAYS_DEFAULT);
    expect(retentionDaysOf("-1")).toBe(RETENTION_DAYS_DEFAULT);
    expect(retentionDaysOf("1")).toBe(RETENTION_DAYS_DEFAULT);
    expect(retentionDaysOf("400")).toBe(RETENTION_DAYS_DEFAULT);
    expect(retentionDaysOf("九十")).toBe(RETENTION_DAYS_DEFAULT);
    expect(retentionDaysOf("90日")).toBe(RETENTION_DAYS_DEFAULT);
  });
});

describe("retentionCutoff", () => {
  it("その日数だけ前の時刻を返す（これより前に届いた分が消える）", () => {
    const now = new Date("2026-08-15T00:00:00.000Z");
    expect(retentionCutoff(now, 90).toISOString()).toBe("2026-05-17T00:00:00.000Z");
  });

  it("日数が変われば境目も動く", () => {
    const now = new Date("2026-08-15T00:00:00.000Z");
    expect(retentionCutoff(now, 30).toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });
});

describe("画面と記録に出す文", () => {
  it("何が消えて何が残るかを、どちらも書く", () => {
    const notice = retentionNoticeText(90);
    expect(notice).toContain("画面の写しと診断情報");
    expect(notice).toContain("90日");
    // 「本文まで消える」と読まれると、届いた要望を残す判断ができなくなる。
    expect(notice).toContain("本文と対応の記録は残ります");

    const note = retentionSweepNote(30);
    expect(note).toContain("30日");
    expect(note).toContain("本文と記録は残しています");
  });
});
