import type { AuditLogRepository } from "../../domain/repositories/AuditLogRepository";
import type { PlIssueAckRepository } from "../../domain/repositories/PlIssueAckRepository";
import type { PlIssueAckKey, PlIssueAckStatus } from "../../domain/rules/plIssueAck";

export const ACK_PL_ISSUE_ACTION = "acknowledge_pl_issue";
export const UNACK_PL_ISSUE_ACTION = "unacknowledge_pl_issue";
export const BULK_ACK_PL_ISSUE_ACTION = "bulk_acknowledge_pl_issue";

/** 判定の種類ごとの、記録に残す言い方 */
const STATUS_LABEL: Record<PlIssueAckStatus, string> = {
  ok: "このままでよい",
  later: "あとで見る",
};

export interface AcknowledgePlIssueInput extends PlIssueAckKey {
  yearMonth: string;
  status: PlIssueAckStatus;
  note: string | null;
  /** 判断したときの値 (翌月に引き継ぐかの判定に使う) */
  value: number | null;
  actorId: string;
  actorName: string;
}

/**
 * 指摘を見たうえで下した判断 (問題なし / あとで見る) を残す。
 *
 * 指摘は表示のたびに導出されるので、ここで保存するのは指摘を指すキーと判断だけになる。
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

    await this.ackRepo.save(input.yearMonth, key, {
      status: input.status,
      note,
      valueAtAck: Number.isFinite(input.value) ? (input.value as number) : null,
      ackedBy: input.actorId,
    });
    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: ACK_PL_ISSUE_ACTION,
      summary: `${input.yearMonth} 車番${input.vehicleNo} の指摘(${input.field}/${input.code})を「${STATUS_LABEL[input.status]}」にした`,
      detail: { yearMonth: input.yearMonth, ...key, status: input.status, note },
    });
  }
}

export interface UnacknowledgePlIssueInput extends PlIssueAckKey {
  yearMonth: string;
  actorId: string;
  actorName: string;
}

/** 判断を取り消して、もう一度確認対象に戻す。 */
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
      summary: `${input.yearMonth} 車番${input.vehicleNo} の指摘(${input.field}/${input.code})の判定を取り消した`,
      detail: { yearMonth: input.yearMonth, ...key },
    });
  }
}

export interface BulkAcknowledgePlIssuesInput {
  yearMonth: string;
  /** 判断を付ける指摘と、そのときの値 */
  targets: readonly (PlIssueAckKey & { value: number | null })[];
  status: PlIssueAckStatus;
  note: string | null;
  /** 何をまとめたのかを記録に残す言葉 (例:「参考レベルの指摘」) */
  reason: string;
  actorId: string;
  actorName: string;
}

/**
 * 同じ種類の指摘をまとめて判断する。
 *
 * 1件ずつ押させると参考レベルの指摘が100件以上あるときに終わらないが、
 * まとめて押せる操作は「押し間違いの被害が大きい」ため、
 * ・何件を対象にするのかを実行前に画面で見せる (呼び出し側の責務)
 * ・実行後にまとめて取り消せる (BulkUnacknowledge)
 * ・誰が何をまとめたのかを監査ログに残す (ここ)
 * の3点をセットにする。
 */
export class BulkAcknowledgePlIssuesUseCase {
  constructor(
    private readonly ackRepo: PlIssueAckRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: BulkAcknowledgePlIssuesInput): Promise<{ count: number }> {
    if (input.targets.length === 0) return { count: 0 };
    const note = input.note?.trim() ? input.note.trim() : null;

    await this.ackRepo.saveMany(
      input.yearMonth,
      input.targets.map((target) => ({
        key: { vehicleNo: target.vehicleNo, field: target.field, code: target.code },
        input: {
          status: input.status,
          note,
          valueAtAck: Number.isFinite(target.value) ? (target.value as number) : null,
          ackedBy: input.actorId,
        },
      })),
    );
    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: BULK_ACK_PL_ISSUE_ACTION,
      summary: `${input.yearMonth} ${input.reason} ${input.targets.length}件を「${STATUS_LABEL[input.status]}」にした`,
      detail: {
        yearMonth: input.yearMonth,
        status: input.status,
        reason: input.reason,
        count: input.targets.length,
        targets: input.targets.map((t) => `${t.vehicleNo}/${t.field}/${t.code}`),
      },
    });
    return { count: input.targets.length };
  }
}

export interface BulkUnacknowledgePlIssuesInput {
  yearMonth: string;
  targets: readonly PlIssueAckKey[];
  actorId: string;
  actorName: string;
}

/** まとめて付けた判断をまとめて取り消す (「元に戻す」)。 */
export class BulkUnacknowledgePlIssuesUseCase {
  constructor(
    private readonly ackRepo: PlIssueAckRepository,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async execute(input: BulkUnacknowledgePlIssuesInput): Promise<{ count: number }> {
    if (input.targets.length === 0) return { count: 0 };
    await this.ackRepo.removeMany(input.yearMonth, input.targets);
    await this.auditLog.record({
      actorId: input.actorId,
      actorName: input.actorName,
      action: UNACK_PL_ISSUE_ACTION,
      summary: `${input.yearMonth} まとめて付けた判定 ${input.targets.length}件を取り消した`,
      detail: {
        yearMonth: input.yearMonth,
        count: input.targets.length,
        targets: input.targets.map((t) => `${t.vehicleNo}/${t.field}/${t.code}`),
      },
    });
    return { count: input.targets.length };
  }
}
