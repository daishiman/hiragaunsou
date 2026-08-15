import { describe, expect, it, vi } from "vitest";
import { sweepRetention } from "../../src/usecase/improvements/sweepRetention";
import type {
  ImprovementAuditEntry,
  ImprovementRepository,
} from "../../src/domain/repositories/ImprovementRepository";
import { RETENTION_SWEEP_MAX } from "../../src/domain/rules/improvementRetention";

/**
 * 保存期間を過ぎた写し・診断情報の掃除。
 *
 * 掃除は誰も見ていない裏で走るので、ここで固定するのは次の3つ。
 *   1. 消す境目を、掃除する側ではなく保存期間の決まりから作る
 *   2. 消したら必ず記録が残る (「あったはずの写しが無い」を説明できる)
 *   3. 消すものが無い回は、記録も書かない (何もしていない回の記録で埋めない)
 */

const NOW = new Date("2026-08-15T00:00:00.000Z");

function repoWith(
  swept: { requestIds: string[]; shots: number; diagnostics: number },
  appendAudit = vi.fn(async () => {}),
) {
  const sweepExpiredAttachments = vi.fn(async () => swept);
  const repo = { sweepExpiredAttachments, appendAudit } as unknown as ImprovementRepository;
  return { repo, sweepExpiredAttachments, appendAudit };
}

describe("sweepRetention", () => {
  it("保存期間だけ前を境目にし、1回に扱う件数の上限を渡す", async () => {
    const { repo, sweepExpiredAttachments } = repoWith({
      requestIds: [],
      shots: 0,
      diagnostics: 0,
    });
    await sweepRetention(repo, { now: NOW, days: 90 });

    const [cutoff, limit] = sweepExpiredAttachments.mock.calls[0] as unknown as [Date, number];
    expect(cutoff.toISOString()).toBe("2026-05-17T00:00:00.000Z");
    expect(limit).toBe(RETENTION_SWEEP_MAX);
  });

  it("消したら、消した要望それぞれに記録を残す", async () => {
    const { repo, appendAudit } = repoWith({
      requestIds: ["improve_a", "improve_b"],
      shots: 2,
      diagnostics: 1,
    });
    const report = await sweepRetention(repo, { now: NOW, days: 90 });

    expect(report.requestIds).toEqual(["improve_a", "improve_b"]);
    expect(report.shots).toBe(2);
    expect(report.diagnostics).toBe(1);

    const entries = appendAudit.mock.calls[0]![0] as unknown as ImprovementAuditEntry[];
    expect(entries).toHaveLength(2);
    expect(entries[0]!.action).toBe("retention_sweep");
    // 人が押した操作ではないので、誰かのせいにしない。
    expect(entries[0]!.actorId).toBeNull();
    expect(entries[0]!.actorName).toBe("自動整理");
    expect(entries[0]!.reason).toContain("90日");
    expect(entries[0]!.reason).toContain("本文と記録は残しています");
  });

  it("消すものが無い回は、記録を書かない", async () => {
    const { repo, appendAudit } = repoWith({ requestIds: [], shots: 0, diagnostics: 0 });
    const report = await sweepRetention(repo, { now: NOW, days: 90 });

    expect(appendAudit).not.toHaveBeenCalled();
    expect(report.requestIds).toEqual([]);
  });

  it("1回に扱う件数は呼び出し側から狭められる", async () => {
    const { repo, sweepExpiredAttachments } = repoWith({
      requestIds: [],
      shots: 0,
      diagnostics: 0,
    });
    await sweepRetention(repo, { now: NOW, days: 30, limit: 5 });

    const [cutoff, limit] = sweepExpiredAttachments.mock.calls[0] as unknown as [Date, number];
    expect(cutoff.toISOString()).toBe("2026-07-16T00:00:00.000Z");
    expect(limit).toBe(5);
  });
});
