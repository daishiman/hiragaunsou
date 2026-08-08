import { describe, expect, it } from "vitest";
import type { AuditLogRecord, AuditLogRepository } from "../../src/domain/repositories/AuditLogRepository";
import type {
  PlIssueAckInput,
  PlIssueAckRepository,
} from "../../src/domain/repositories/PlIssueAckRepository";
import { plIssueKey, type PlIssueAckKey } from "../../src/domain/rules/plIssueAck";
import {
  ACK_PL_ISSUE_ACTION,
  AcknowledgePlIssueUseCase,
  BULK_ACK_PL_ISSUE_ACTION,
  BulkAcknowledgePlIssuesUseCase,
  BulkUnacknowledgePlIssuesUseCase,
  UNACK_PL_ISSUE_ACTION,
  UnacknowledgePlIssueUseCase,
} from "../../src/usecase/steps/acknowledgePlIssue";

function build() {
  const saved: { yearMonth: string; key: PlIssueAckKey; input: PlIssueAckInput }[] = [];
  const removed: { yearMonth: string; key: PlIssueAckKey }[] = [];
  const ackRepo: PlIssueAckRepository = {
    findByYearMonth: async () => [],
    save: async (yearMonth, key, input) => {
      saved.push({ yearMonth, key, input });
    },
    saveMany: async (yearMonth, entries) => {
      for (const entry of entries) saved.push({ yearMonth, key: entry.key, input: entry.input });
    },
    remove: async (yearMonth, key) => {
      removed.push({ yearMonth, key });
    },
    removeMany: async (yearMonth, keys) => {
      for (const key of keys) removed.push({ yearMonth, key });
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
      status: "ok",
      note: null,
      value: 900_000,
    });

    expect(saved).toEqual([
      {
        yearMonth: "2026-05",
        key: { ...key },
        input: { status: "ok", note: null, valueAtAck: 900_000, ackedBy: "u-1" },
      },
    ]);
    expect(plIssueKey(saved[0]!.key)).toBe("10::fare::anomaly");
  });

  /**
   * 「あとで見る」も同じ場所に保存する。別のテーブルに分けると、
   * 後回しにしたまま年月を切り替えたときに片方だけ読み落とす事故が起きる。
   */
  it("あとで見る(後回し)も同じキーの上に保存する", async () => {
    const { ackRepo, auditLog, saved } = build();

    await new AcknowledgePlIssueUseCase(ackRepo, auditLog).execute({
      ...actor,
      ...key,
      yearMonth: "2026-05",
      status: "later",
      note: null,
      value: 900_000,
    });

    expect(saved[0]?.input.status).toBe("later");
  });

  /**
   * 判断したときの値を残しておかないと、翌月に「先月と同じ状況か」を比べられない。
   * (値が大きく動いていたら先月の判断は引き継がない)
   */
  it("判断したときの値を一緒に残す", async () => {
    const { ackRepo, auditLog, saved } = build();

    await new AcknowledgePlIssueUseCase(ackRepo, auditLog).execute({
      ...actor,
      ...key,
      yearMonth: "2026-05",
      status: "ok",
      note: null,
      value: null,
    });

    expect(saved[0]?.input.valueAtAck).toBeNull();
  });

  /** 空白だけのメモは「書いた」ことになってしまうので残さない。 */
  it("空白だけのメモは残さない", async () => {
    const { ackRepo, auditLog, saved } = build();

    await new AcknowledgePlIssueUseCase(ackRepo, auditLog).execute({
      ...actor,
      ...key,
      yearMonth: "2026-05",
      status: "ok",
      note: "   ",
      value: null,
    });

    expect(saved[0]?.input.note).toBeNull();
  });

  it("メモは前後の空白を落として残す", async () => {
    const { ackRepo, auditLog, saved } = build();

    await new AcknowledgePlIssueUseCase(ackRepo, auditLog).execute({
      ...actor,
      ...key,
      yearMonth: "2026-05",
      status: "ok",
      note: "  臨時便のため運賃が高い  ",
      value: null,
    });

    expect(saved[0]?.input.note).toBe("臨時便のため運賃が高い");
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
      status: "ok",
      note: null,
      value: null,
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

describe("BulkAcknowledgePlIssuesUseCase", () => {
  const targets = [
    { ...key, value: 900_000 },
    { vehicleNo: "11", field: "fare", code: "anomaly", value: 800_000 } as const,
  ];

  it("渡された指摘をまとめて保存し、処理した件数を返す", async () => {
    const { ackRepo, auditLog, saved } = build();

    const result = await new BulkAcknowledgePlIssuesUseCase(ackRepo, auditLog).execute({
      ...actor,
      yearMonth: "2026-05",
      targets,
      status: "ok",
      note: null,
      reason: "「運賃が例月と違います」と同じ指摘",
    });

    expect(result.count).toBe(2);
    expect(saved.map((s) => s.key.vehicleNo)).toEqual(["10", "11"]);
    expect(saved[0]?.input.valueAtAck).toBe(900_000);
  });

  /** 何件をまとめて通したのかが残らないと、後から妥当性を確かめられない。 */
  it("何をまとめて通したのかと件数を監査ログに残す", async () => {
    const { ackRepo, auditLog, entries } = build();

    await new BulkAcknowledgePlIssuesUseCase(ackRepo, auditLog).execute({
      ...actor,
      yearMonth: "2026-05",
      targets,
      status: "ok",
      note: null,
      reason: "参考レベルの指摘",
    });

    expect(entries[0]).toMatchObject({ action: BULK_ACK_PL_ISSUE_ACTION, actorName: "今西" });
    expect(entries[0]?.summary).toContain("2件");
    expect(entries[0]?.summary).toContain("参考レベルの指摘");
  });
});

describe("BulkUnacknowledgePlIssuesUseCase", () => {
  it("まとめて付けた判断をまとめて取り消す(直後の「元に戻す」)", async () => {
    const { ackRepo, auditLog, removed } = build();

    const result = await new BulkUnacknowledgePlIssuesUseCase(ackRepo, auditLog).execute({
      ...actor,
      yearMonth: "2026-05",
      targets: [key, { vehicleNo: "11", field: "fare", code: "anomaly" }],
    });

    expect(result.count).toBe(2);
    expect(removed.map((r) => r.key.vehicleNo)).toEqual(["10", "11"]);
  });
});
