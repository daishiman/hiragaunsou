import type { ImprovementRepository } from "../../domain/repositories/ImprovementRepository";
import {
  RETENTION_SWEEP_MAX,
  retentionCutoff,
  retentionSweepNote,
} from "../../domain/rules/improvementRetention";

/**
 * 保存期間を過ぎた画面の写しと診断情報を消す。
 *
 * 走らせる場所は「改善要望が届いたとき」の裏。専用の定時実行を作らないのは、
 * 溜まるのは要望が届いたときだけだから。届かない月は掃除する必要もない。
 * この形にしておくと、増える速さと掃除する速さが自然に釣り合う。
 *
 * 消したことは記録に残す。裏で走る処理が黙って消すと、
 * 「あったはずの写しが無い」の理由を後から誰も説明できなくなる。
 */

export interface RetentionSweepReport {
  days: number;
  cutoff: Date;
  /** 写し・診断情報を消した要望の id。 */
  requestIds: string[];
  shots: number;
  diagnostics: number;
}

export async function sweepRetention(
  repo: ImprovementRepository,
  input: { now: Date; days: number; limit?: number },
): Promise<RetentionSweepReport> {
  const cutoff = retentionCutoff(input.now, input.days);
  const limit = input.limit ?? RETENTION_SWEEP_MAX;
  const swept = await repo.sweepExpiredAttachments(cutoff, limit);

  if (swept.requestIds.length > 0) {
    await repo.appendAudit(
      swept.requestIds.map((requestId) => ({
        requestId,
        // 人が押した操作ではないので、誰かのせいにしない。
        actorId: null,
        actorName: "自動整理",
        action: "retention_sweep" as const,
        fromStatus: null,
        toStatus: null,
        reason: retentionSweepNote(input.days),
      })),
    );
  }

  return {
    days: input.days,
    cutoff,
    requestIds: swept.requestIds,
    shots: swept.shots,
    diagnostics: swept.diagnostics,
  };
}
