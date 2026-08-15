import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordHandoffEvent } from "../../src/usecase/improvements/recordHandoffEvent";
import type {
  ImprovementDetail,
  ImprovementRepository,
} from "../../src/domain/repositories/ImprovementRepository";
import type {
  InstructionTokenRecord,
  InstructionTokenRepository,
} from "../../src/domain/repositories/InstructionTokenRepository";
import { CI_ABILITIES, DEVELOPER_ABILITIES } from "../../src/domain/rules/instructionAccess";
import type { ImprovementStatus } from "../../src/domain/rules/improvement";

/**
 * 「直した」と伝えてきた鍵を、どこまで信じるか。
 *
 * ここで確かめたいのは、鍵1本の使い道が広がりすぎていないこと。
 * 手元の開発者に渡した鍵で、触ってもいない要望まで閉じられては困る。
 */

const PR = { url: "https://github.com/daishiman/hiragaunsou/pull/42", number: 42 };

function detail(status: ImprovementStatus): ImprovementDetail {
  return {
    id: "improve_1",
    status,
    path: "/vehicle-pl",
    routePattern: "/vehicle-pl",
    screenLabel: "車両別収支",
    body: "表示が崩れる",
    reporterName: "現場の人",
    handledNote: null,
    hasShot: false,
    instruction: null,
    archivedAt: null,
    duplicateOfId: null,
    prUrl: null,
    prNumber: null,
    createdAt: new Date("2026-08-15T00:00:00.000Z"),
    updatedAt: new Date("2026-08-15T00:00:00.000Z"),
    viewport: null,
    userAgent: null,
    shot: null,
    handledByName: null,
    handledAt: null,
    diagnostics: null,
  };
}

function token(over: Partial<InstructionTokenRecord> = {}): InstructionTokenRecord {
  return {
    id: "tok_1",
    name: "手元の鍵",
    scopeIds: ["improve_1"],
    abilities: [...DEVELOPER_ABILITIES],
    companyId: null,
    tokenHash: "hash",
    createdByName: "管理者",
    createdAt: new Date("2026-08-15T00:00:00.000Z"),
    expiresAt: new Date("2026-08-22T00:00:00.000Z"),
    revokedAt: null,
    revokedReason: null,
    lastUsedAt: null,
    useCount: 0,
    ...over,
  };
}

function makeDeps(row: ImprovementDetail | null, hasClaim = true) {
  const recordHandoff = vi.fn(async () => {});
  const appendAudit = vi.fn(async () => {});
  const touch = vi.fn(async () => {});
  const repo = {
    findById: vi.fn(async () => row),
    recordHandoff,
    appendAudit,
  } as unknown as ImprovementRepository;
  const tokens = {
    hasClaim: vi.fn(async () => hasClaim),
    touch,
  } as unknown as InstructionTokenRepository;
  return { repo, tokens, recordHandoff, appendAudit, touch };
}

beforeEach(() => vi.clearAllMocks());

describe("直した結果を鍵から伝える", () => {
  it("取得した件なら、確認依頼の作成でレビュー待ちになる", async () => {
    const deps = makeDeps(detail("doing"));
    const result = await recordHandoffEvent("improve_1", "pr_opened", PR, token(), deps);

    expect(result).toMatchObject({ ok: true, status: "review" });
    expect(deps.recordHandoff).toHaveBeenCalledWith("improve_1", { status: "review", pr: PR });
  });

  it("取得していない件は、鍵を持っていても進められない", async () => {
    const deps = makeDeps(detail("doing"), false);
    const result = await recordHandoffEvent("improve_1", "pr_merged", PR, token(), deps);

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(deps.recordHandoff).not.toHaveBeenCalled();
    // 断ったときは記録も残さない (触っていない件の履歴を汚さない)
    expect(deps.appendAudit).not.toHaveBeenCalled();
  });

  it("読むだけの鍵では、取得済みでも進められない", async () => {
    const deps = makeDeps(detail("doing"));
    const result = await recordHandoffEvent(
      "improve_1",
      "pr_merged",
      PR,
      token({ abilities: ["read"] }),
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("CI 用の鍵は、取得していなくてもマージを伝えられる", async () => {
    const deps = makeDeps(detail("review"), false);
    const result = await recordHandoffEvent(
      "improve_1",
      "pr_merged",
      PR,
      token({ name: "CI", abilities: [...CI_ABILITIES] }),
      deps,
    );

    expect(result).toMatchObject({ ok: true, status: "done" });
    // どちらの主体が閉じたのかを残す
    expect(deps.appendAudit).toHaveBeenCalledWith([
      expect.objectContaining({ actorName: "鍵(CI): CI", action: "handoff", actorId: null }),
    ]);
  });

  it("確認依頼の URL が無ければ、レビュー待ちにも対応済みにもしない", async () => {
    const deps = makeDeps(detail("doing"));
    const result = await recordHandoffEvent("improve_1", "pr_opened", null, token(), deps);

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(deps.recordHandoff).not.toHaveBeenCalled();
  });

  it("取り下げは URL 無しでも通り、対応中へ戻して控えを消す", async () => {
    const deps = makeDeps(detail("review"));
    const result = await recordHandoffEvent("improve_1", "pr_closed", null, token(), deps);

    expect(result).toMatchObject({ ok: true, status: "doing" });
    expect(deps.recordHandoff).toHaveBeenCalledWith("improve_1", { status: "doing", pr: null });
  });

  it("見送りにした件は、マージされても対応済みにしない", async () => {
    const deps = makeDeps(detail("dropped"));
    const result = await recordHandoffEvent("improve_1", "pr_merged", PR, token(), deps);

    expect(result).toMatchObject({ ok: true, status: null });
    expect(deps.recordHandoff).not.toHaveBeenCalled();
    // 状態は動かさないが、何が起きたかは記録に残す
    expect(deps.appendAudit).toHaveBeenCalled();
  });

  it("無い要望には何もしない", async () => {
    const deps = makeDeps(null);
    const result = await recordHandoffEvent("improve_x", "pr_merged", PR, token(), deps);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
