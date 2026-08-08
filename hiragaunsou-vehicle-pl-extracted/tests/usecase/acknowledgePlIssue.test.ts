import { describe, expect, it } from "vitest";
import type { AuditLogRecord, AuditLogRepository } from "../../src/domain/repositories/AuditLogRepository";
import type { PlIssueAckRepository } from "../../src/domain/repositories/PlIssueAckRepository";
import { plIssueKey, type PlIssueAckKey } from "../../src/domain/rules/plIssueAck";
import {
  ACK_PL_ISSUE_ACTION,
  AcknowledgePlIssueUseCase,
  UNACK_PL_ISSUE_ACTION,
  UnacknowledgePlIssueUseCase,
} from "../../src/usecase/steps/acknowledgePlIssue";

function build() {
  const saved: { yearMonth: string; key: PlIssueAckKey; note: string | null; ackedBy: string | null }[] =
    [];
  const removed: { yearMonth: string; key: PlIssueAckKey }[] = [];
  const ackRepo: PlIssueAckRepository = {
    findByYearMonth: async () => [],
    save: async (yearMonth, key, note, ackedBy) => {
      saved.push({ yearMonth, key, note, ackedBy });
    },
    remove: async (yearMonth, key) => {
      removed.push({ yearMonth, key });
    },
  };

  const entries: AuditLogRecord[] = [];
  const auditLog = {
    record: async (entry: AuditLogRecord) => {
      entries.push(entry);
    },
    findRecent: async () => [],
  } as unknown as AuditLogRepository;

  return { ackRepo, auditLog, saved, removed, entries };
}

const actor = { actorId: "u-1", actorName: "今西" };
const key = { vehicleNo: "10", field: "fare", code: "anomaly" } as const;

describe("AcknowledgePlIssueUseCase", () => {
  it("指摘を指すキーを保存する(指摘そのものは保存しない)", async () => {
    const { ackRepo, auditLog, saved } = build();

    await new AcknowledgePlIssueUseCase(ackRepo, auditLog).execute({
      ...actor,
      ...key,
      yearMonth: "2026-05",
      note: null,
    });

    expect(saved).toEqual([
      { yearMonth: "2026-05", key: { ...key }, note: null, ackedBy: "u-1" },
    ]);
    expect(plIssueKey(saved[0]!.key)).toBe("10::fare::anomaly");
  });

  /** 空白だけのメモは「書いた」ことになってしまうので残さない。 */
  it("空白だけのメモは残さない", async () => {
    const { ackRepo, auditLog, saved } = build();

    await new AcknowledgePlIssueUseCase(ackRepo, auditLog).execute({
      ...actor,
      ...key,
      yearMonth: "2026-05",
      note: "   ",
    });

    expect(saved[0]?.note).toBeNull();
  });

  it("メモは前後の空白を落として残す", async () => {
    const { ackRepo, auditLog, saved } = build();

    await new AcknowledgePlIssueUseCase(ackRepo, auditLog).execute({
      ...actor,
      ...key,
      yearMonth: "2026-05",
      note: "  臨時便のため運賃が高い  ",
    });

    expect(saved[0]?.note).toBe("臨時便のため運賃が高い");
  });

  /**
   * 数字を直さずに通した判断は後から必ず問われる。
   * テーブルの acked_by だけでなく監査ログにも残し、操作の履歴として1本で追えるようにする。
   */
  it("誰がどの指摘を通したかを監査ログに残す", async () => {
    const { ackRepo, auditLog, entries } = build();

    await new AcknowledgePlIssueUseCase(ackRepo, auditLog).execute({
      ...actor,
      ...key,
      yearMonth: "2026-05",
      note: null,
    });

    expect(entries[0]).toMatchObject({ action: ACK_PL_ISSUE_ACTION, actorName: "今西" });
    expect(entries[0]?.summary).toContain("車番10");
  });
});

describe("UnacknowledgePlIssueUseCase", () => {
  it("確認済みを取り消して、もう一度確認対象に戻す", async () => {
    const { ackRepo, auditLog, removed, entries } = build();

    await new UnacknowledgePlIssueUseCase(ackRepo, auditLog).execute({
      ...actor,
      ...key,
      yearMonth: "2026-05",
    });

    expect(removed).toEqual([{ yearMonth: "2026-05", key: { ...key } }]);
    expect(entries[0]).toMatchObject({ action: UNACK_PL_ISSUE_ACTION });
  });
});
