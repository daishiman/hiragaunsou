import type { AuditLogRepository } from "../../domain/repositories/AuditLogRepository";
import type { PlIssueAckRepository } from "../../domain/repositories/PlIssueAckRepository";
import type { PlIssueAckKey } from "../../domain/rules/plIssueAck";

export const ACK_PL_ISSUE_ACTION = "acknowledge_pl_issue";
export const UNACK_PL_ISSUE_ACTION = "unacknowledge_pl_issue";

export interface AcknowledgePlIssueInput extends PlIssueAckKey {
  yearMonth: string;
  note: string | null;
  actorId: string;
  actorName: string;
}

/**
 * 指摘を見たうえで「このままでよい」と判断した記録を残す / 取り消す。
 *
 * 指摘は表示のたびに導出されるので、ここで保存するのは指摘を指すキーだけになる。
 * 誰がその判断を下したかは後から必ず問われる (数字を直さずに通した理由が要る) ため、
 * テーブルの acked_by に加えて監査ログにも残す。
 */
export class AcknowledgePlIssueUseCase {
  constructor(
    private readonly ackRepo: PlIssueAckRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: AcknowledgePlIssueInput): Promise<void> {
    const note = input.note?.trim() ? input.note.trim() : null;
    const key: PlIssueAckKey = {
      vehicleNo: input.vehicleNo,
      field: input.field,
      code: input.code,
    };

    await this.ackRepo.save(input.yearMonth, key, note, input.actorId);
    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: ACK_PL_ISSUE_ACTION,
      summary: `${input.yearMonth} 車番${input.vehicleNo} の指摘(${input.field}/${input.code})を確認済みにした`,
      detail: { yearMonth: input.yearMonth, ...key, note },
    });
  }
}

export interface UnacknowledgePlIssueInput extends PlIssueAckKey {
  yearMonth: string;
  actorId: string;
  actorName: string;
}

/** 確認済みを取り消して、もう一度確認対象に戻す。 */
export class UnacknowledgePlIssueUseCase {
  constructor(
    private readonly ackRepo: PlIssueAckRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: UnacknowledgePlIssueInput): Promise<void> {
    const key: PlIssueAckKey = {
      vehicleNo: input.vehicleNo,
      field: input.field,
      code: input.code,
    };

    await this.ackRepo.remove(input.yearMonth, key);
    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: UNACK_PL_ISSUE_ACTION,
      summary: `${input.yearMonth} 車番${input.vehicleNo} の指摘(${input.field}/${input.code})の確認済みを取り消した`,
      detail: { yearMonth: input.yearMonth, ...key },
    });
  }
}
