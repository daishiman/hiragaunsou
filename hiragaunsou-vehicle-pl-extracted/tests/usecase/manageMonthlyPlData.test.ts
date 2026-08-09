import { describe, expect, it, vi } from "vitest";
import type { AuditLogEntry, AuditLogRepository } from "../../src/domain/repositories/AuditLogRepository";
import {
  DELETE_MONTHLY_PL_ACTION,
  DeleteMonthlyPlUseCase,
  ListMonthsWithoutImportsUseCase,
  type MonthlyPlSummary,
} from "../../src/usecase/steps/manageMonthlyPlData";

function summary(over: Partial<MonthlyPlSummary> & { yearMonth: string }): MonthlyPlSummary {
  return { vehicleCount: 101, sales: 0, profit: -8_826_645, confirmed: 0, ...over };
}

function stubPlRepo(summaries: MonthlyPlSummary[]) {
  return {
    listYearMonthSummaries: vi.fn(async () => summaries),
    deleteYearMonth: vi.fn(async () => summaries.find(() => true)?.vehicleCount ?? 0),
  };
}

function stubImportRepo(months: string[]) {
  return { listYearMonths: vi.fn(async () => months) };
}

function stubAuditLog() {
  const entries: AuditLogEntry[] = [];
  const repo: AuditLogRepository = {
    record: async (entry) => {
      entries.push(entry);
    },
    listRecent: async () => [],
  };
  return { repo, entries };
}

describe("ListMonthsWithoutImportsUseCase", () => {
  it("取込がある月は一覧に出さない", async () => {
    const months = await new ListMonthsWithoutImportsUseCase(
      stubPlRepo([summary({ yearMonth: "2026-07" }), summary({ yearMonth: "2026-05" })]),
      stubImportRepo(["2026-05"]),
    ).execute();

    expect(months.map((m) => m.yearMonth)).toEqual(["2026-07"]);
  });

  it("台数・売上・損益を添えて返す(消す前に中身を見せるため)", async () => {
    const months = await new ListMonthsWithoutImportsUseCase(
      stubPlRepo([summary({ yearMonth: "2026-07", vehicleCount: 101, sales: 0, profit: -8_826_645 })]),
      stubImportRepo([]),
    ).execute();

    expect(months[0]).toMatchObject({ vehicleCount: 101, sales: 0, profit: -8_826_645 });
  });
});

describe("DeleteMonthlyPlUseCase", () => {
  const actor = { actorId: "u1", actorName: "管理者" };

  it("取込が1件も無い月の収支表を消し、誰が何を消したかを記録する", async () => {
    const plRepo = stubPlRepo([summary({ yearMonth: "2026-07" })]);
    const audit = stubAuditLog();

    const result = await new DeleteMonthlyPlUseCase(
      plRepo,
      stubImportRepo(["2026-05"]),
      audit.repo,
    ).execute({ ...actor, yearMonth: "2026-07" });

    expect(result).toEqual({ yearMonth: "2026-07", deletedRows: 101 });
    expect(plRepo.deleteYearMonth).toHaveBeenCalledWith("2026-07");
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      actorId: "u1",
      actorName: "管理者",
      action: DELETE_MONTHLY_PL_ACTION,
    });
    expect(audit.entries[0]?.summary).toContain("2026-07");
  });

  it("取込がある月は消せない(取り込んだ内容から作り直せる表を1操作で失わせない)", async () => {
    const plRepo = stubPlRepo([summary({ yearMonth: "2026-05", vehicleCount: 106 })]);

    await expect(
      new DeleteMonthlyPlUseCase(plRepo, stubImportRepo(["2026-05"]), stubAuditLog().repo).execute({
        ...actor,
        yearMonth: "2026-05",
      }),
    ).rejects.toThrow(/ファイルが取り込まれています/);
    expect(plRepo.deleteYearMonth).not.toHaveBeenCalled();
  });

  it("確定済みの月は消せない(締めた意思表示を先に戻してもらう)", async () => {
    const plRepo = stubPlRepo([summary({ yearMonth: "2026-07", confirmed: 101 })]);

    await expect(
      new DeleteMonthlyPlUseCase(plRepo, stubImportRepo([]), stubAuditLog().repo).execute({
        ...actor,
        yearMonth: "2026-07",
      }),
    ).rejects.toThrow(/確定済み/);
    expect(plRepo.deleteYearMonth).not.toHaveBeenCalled();
  });

  it("収支表が無い月を指定しても、記録だけが残ることはない", async () => {
    const plRepo = stubPlRepo([summary({ yearMonth: "2026-07" })]);
    const audit = stubAuditLog();

    await expect(
      new DeleteMonthlyPlUseCase(plRepo, stubImportRepo([]), audit.repo).execute({
        ...actor,
        yearMonth: "2026-06",
      }),
    ).rejects.toThrow(/見つかりませんでした/);
    expect(plRepo.deleteYearMonth).not.toHaveBeenCalled();
    expect(audit.entries).toHaveLength(0);
  });
});
