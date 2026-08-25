import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  instructionHashOf,
  publishInstructions,
  shotUrlFor,
  SHOT_URL_TTL_MS,
  type InstructionDeps,
} from "../../src/usecase/improvements/publishInstructions";
import {
  authorizeToken,
  combineMarkdown,
  readInstructions,
} from "../../src/usecase/improvements/readInstructions";
import { hashAccessToken } from "../../src/domain/rules/instructionAccess";
import type {
  ImprovementDetail,
  ImprovementRepository,
} from "../../src/domain/repositories/ImprovementRepository";
import type {
  InstructionTokenRecord,
  InstructionTokenRepository,
} from "../../src/domain/repositories/InstructionTokenRepository";
import type { StoredInstruction } from "../../src/domain/rules/improvementInstructionSync";
import type { StoredDiagnostics } from "../../src/domain/rules/diagnostics";

/**
 * 発行 (publishInstructions) と取得 (readInstructions) を、入口を通さずに検証する。
 *
 * ここで固定するのは、どちらの入口から来ても外せない3つ。
 *   1. 何度押しても版が増えない (内容が変わったときだけ動く)
 *   2. 鍵の範囲の外・未発行・取り下げ済みは1件も読ませない
 *   3. 読まれたら必ず記録が残る (鍵が外へ出たときに何を読まれたか数えられる)
 */

const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";
const NOW = new Date("2026-08-15T03:00:00.000Z");

function diagnostics(over: Partial<StoredDiagnostics> = {}): StoredDiagnostics {
  return {
    version: 1,
    referrer: "/grid",
    build: { id: "abc123", commit: "abc123" },
    environment: {
      userAgent: "UA",
      browser: "Chrome 141",
      os: "Windows 11",
      viewport: "1440×900",
      devicePixelRatio: 2,
      touch: false,
      language: "ja",
      timezone: "Asia/Tokyo",
      online: true,
    },
    performance: { pageLoadMs: 820, slowestApi: null, medianApiMs: 120 },
    console: [],
    errors: [],
    network: [],
    slowApi: [],
    breadcrumbs: [],
    notes: [],
    occurredAt: { utc: "2026-08-15T01:00:00.000Z", jst: "2026-08-15 10:00:00 JST" },
    screen: {
      path: "/vehicle/1177",
      routePattern: "/vehicle/[vehicleNo]",
      label: "車両別の収支",
      sourceFile: "app/(app)/vehicle/[vehicleNo]/page.tsx",
    },
    reporter: { id: "u1", name: "入力担当", role: "input_staff", companyId: "（1社専用）" },
    ...over,
  };
}

function published(over: Partial<StoredInstruction> = {}): StoredInstruction {
  return {
    version: 1,
    hash: "指紋",
    state: "published",
    syncedFields: null,
    publishedAt: new Date("2026-08-15T02:00:00.000Z"),
    fetchedAt: null,
    ...over,
  };
}

function detail(id: string, over: Partial<ImprovementDetail> = {}): ImprovementDetail {
  return {
    id,
    status: "open",
    path: "/vehicle/1177",
    routePattern: "/vehicle/[vehicleNo]",
    screenLabel: "車両別の収支",
    body: `${id} の指摘です。`,
    reporterName: "入力担当",
    handledNote: null,
    hasShot: false,
    instruction: null,
    archivedAt: null,
    duplicateOfId: null,
    createdAt: new Date("2026-08-15T01:00:00.000Z"),
    updatedAt: new Date("2026-08-15T01:00:00.000Z"),
    viewport: "1440×900",
    userAgent: "UA",
    shot: null,
    handledByName: null,
    handledAt: null,
    diagnostics: diagnostics(),
    ...over,
  };
}

/** 実装の順番 (権利を取る → 書く → 記録) をそのまま数えられる、最小の偽リポジトリ。 */
function makeRepo(rows: ImprovementDetail[]) {
  const calls: string[] = [];
  const repo = {
    findManyByIds: vi.fn(async (ids: string[]) => rows.filter((r) => ids.includes(r.id))),
    beginPublishing: vi.fn(async (id: string) => {
      calls.push(`begin:${id}`);
      return true;
    }),
    releasePublishing: vi.fn(async (id: string) => {
      calls.push(`release:${id}`);
    }),
    markPublished: vi.fn(async (id: string) => {
      calls.push(`publish:${id}`);
      return true;
    }),
    markFetched: vi.fn(async (ids: string[]) => {
      calls.push(`fetched:${ids.join(",")}`);
    }),
    recordHandoff: vi.fn(async (id: string, input: { status?: string }) => {
      calls.push(`handoff:${id}:${input.status ?? "-"}`);
    }),
    appendAudit: vi.fn(async () => {
      calls.push("audit");
    }),
  } as unknown as ImprovementRepository;
  return { repo, calls };
}

function deps(repo: ImprovementRepository): InstructionDeps {
  return {
    repo,
    appOrigin: ORIGIN,
    shotSecret: "test-secret:improvement-shot",
    actorId: "admin-1",
    actorName: "管理者",
  };
}

function tokenRecord(over: Partial<InstructionTokenRecord> = {}): InstructionTokenRecord {
  return {
    id: "tok_1",
    name: "2件を渡すための鍵",
    scopeIds: ["a", "b"],
    abilities: ["read", "status:own"],
    companyId: null,
    tokenHash: "hash",
    createdByName: "管理者",
    createdAt: new Date("2026-08-15T02:00:00.000Z"),
    expiresAt: new Date("2026-08-22T00:00:00.000Z"),
    revokedAt: null,
    revokedReason: null,
    lastUsedAt: null,
    useCount: 0,
    ...over,
  };
}

function makeTokens(record: InstructionTokenRecord | null) {
  const touch = vi.fn(async () => {});
  const findByHash = vi.fn(async () => record);
  const recordClaims = vi.fn(async () => {});
  const hasClaim = vi.fn(async () => true);
  const tokens = {
    touch,
    findByHash,
    recordClaims,
    hasClaim,
  } as unknown as InstructionTokenRepository;
  return { tokens, touch, findByHash, recordClaims, hasClaim };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("指紋（何が変わったら更新とみなすか）", () => {
  it("版が上がっただけでは指紋は変わらない（空の更新を積み上げない）", async () => {
    const item = detail("a");
    const { repo } = makeRepo([item]);
    const d = deps(repo);
    const first = await instructionHashOf({ ...item, instruction: null }, d);
    const second = await instructionHashOf({ ...item, instruction: published({ version: 9 }) }, d);
    expect(second).toBe(first);
  });

  it("画像URLの期限が変わっても指紋は変わらない（呼ぶたびに更新扱いにしない）", async () => {
    const item = detail("a", { hasShot: true });
    const { repo } = makeRepo([item]);
    const d = deps(repo);
    const before = await instructionHashOf(item, d);
    vi.setSystemTime(new Date(NOW.getTime() + 86_400_000));
    const after = await instructionHashOf(item, d);
    vi.useRealTimers();
    expect(after).toBe(before);
  });

  it("本文が変われば指紋も変わる（本当の変更は取り逃がさない）", async () => {
    const { repo } = makeRepo([]);
    const d = deps(repo);
    const before = await instructionHashOf(detail("a"), d);
    const after = await instructionHashOf(detail("a", { body: "別のことを書きました。" }), d);
    expect(after).not.toBe(before);
  });
});

describe("画像の期限付きURL", () => {
  it("画像が無い件ではURLを作らない", async () => {
    const { repo } = makeRepo([]);
    expect(await shotUrlFor(detail("a"), deps(repo), NOW)).toBeNull();
  });

  it("期限は24時間先で、署名付きの自前URLになる（外のサービスへ置かない）", async () => {
    const { repo } = makeRepo([]);
    const url = await shotUrlFor(detail("a", { hasShot: true }), deps(repo), NOW);
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    expect(parsed.origin).toBe(ORIGIN);
    expect(parsed.pathname).toBe("/api/instructions/shot/a");
    expect(Number(parsed.searchParams.get("exp")) * 1000).toBe(NOW.getTime() + SHOT_URL_TTL_MS);
    expect(parsed.searchParams.get("sig")).toBeTruthy();
  });
});

describe("publishInstructions", () => {
  it("下見（dryRun）は1件も保存しない。下書きは全件そのまま返す", async () => {
    const { repo, calls } = makeRepo([detail("a"), detail("b")]);
    const report = await publishInstructions(["a", "b"], deps(repo), { dryRun: true });
    expect(calls).toEqual([]);
    expect(report.results).toEqual([]);
    expect(report.drafts.map((d) => d.id)).toEqual(["a", "b"]);
    expect(report.drafts[0]?.markdown).toContain("## 受け入れ条件");
  });

  it("渡された順を守る（画面の並びと結果の並びをずらさない）", async () => {
    const { repo } = makeRepo([detail("a"), detail("b"), detail("c")]);
    const report = await publishInstructions(["c", "a", "b"], deps(repo), { dryRun: false });
    expect(report.results.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("内容が変わっていない件には触らない（何度押しても版が増えない）", async () => {
    const item = detail("a");
    const { repo } = makeRepo([item]);
    const d = deps(repo);
    const hash = await instructionHashOf(item, d);
    item.instruction = published({ version: 1, hash });

    const report = await publishInstructions(["a"], d, { dryRun: false });
    expect(report.results[0]?.kind).toBe("skip");
    expect(report.results[0]?.version).toBe(1);
    expect(repo.beginPublishing).not.toHaveBeenCalled();
    expect(repo.markPublished).not.toHaveBeenCalled();
  });

  it("廃棄・見送り・誤作成・重複は対象外として弾き、理由を返す", async () => {
    const rows = [
      detail("arch", { archivedAt: new Date("2026-08-14T00:00:00.000Z") }),
      detail("drop", { status: "dropped" }),
      detail("mis", { status: "invalid" }),
      detail("dup", { status: "duplicate", duplicateOfId: "a" }),
    ];
    const { repo } = makeRepo(rows);
    const report = await publishInstructions(
      rows.map((r) => r.id),
      deps(repo),
      { dryRun: false },
    );
    expect(report.results.every((r) => r.kind === "excluded")).toBe(true);
    expect(report.results.every((r) => r.reason.length > 0)).toBe(true);
    expect(repo.markPublished).not.toHaveBeenCalled();
  });

  it("権利を取れなければ書き込まず、待てば通ると分かる形で返す", async () => {
    const { repo } = makeRepo([detail("a")]);
    (repo.beginPublishing as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const report = await publishInstructions(["a"], deps(repo), { dryRun: false });
    expect(report.results[0]?.ok).toBe(false);
    expect(report.results[0]?.conflict).toBe(true);
    expect(repo.markPublished).not.toHaveBeenCalled();
  });

  it("書き込みに失敗したら権利を返す（詰まったまま残さない）", async () => {
    const { repo, calls } = makeRepo([detail("a")]);
    (repo.markPublished as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("D1 落ちた"));
    const report = await publishInstructions(["a"], deps(repo), { dryRun: false });
    expect(report.results[0]?.ok).toBe(false);
    expect(report.results[0]?.message).toContain("D1 落ちた");
    expect(calls).toContain("release:a");
  });

  it("取り下げ済みの件は、次の版として出し直せる", async () => {
    const { repo } = makeRepo([
      detail("a", { instruction: published({ version: 2, state: "withdrawn" }) }),
    ]);
    const report = await publishInstructions(["a"], deps(repo), { dryRun: false });
    expect(report.results[0]?.kind).toBe("publish");
    expect(report.results[0]?.version).toBe(3);
  });
});

describe("authorizeToken", () => {
  it("鍵が無ければ、付け方まで書いて断る", async () => {
    const { tokens } = makeTokens(null);
    const result = await authorizeToken(null, tokens);
    expect("error" in result && result.error).toContain("Authorization: Bearer");
  });

  it("知らない鍵は断る（照合は指紋で行い、平文はDBに無い）", async () => {
    const { tokens, findByHash } = makeTokens(null);
    const result = await authorizeToken("hgcc_unknown", tokens);
    expect("error" in result).toBe(true);
    expect(findByHash).toHaveBeenCalledWith(await hashAccessToken("hgcc_unknown"));
  });

  it("失効した鍵・期限切れの鍵は断る", async () => {
    const revoked = makeTokens(tokenRecord({ revokedAt: new Date("2026-08-14T00:00:00.000Z") }));
    expect("error" in (await authorizeToken("hgcc_x", revoked.tokens, NOW))).toBe(true);
    const expired = makeTokens(tokenRecord({ expiresAt: new Date("2026-08-01T00:00:00.000Z") }));
    expect("error" in (await authorizeToken("hgcc_x", expired.tokens, NOW))).toBe(true);
  });

  it("生きている鍵は通る", async () => {
    const { tokens } = makeTokens(tokenRecord());
    const result = await authorizeToken("hgcc_x", tokens, NOW);
    expect("token" in result && result.token.id).toBe("tok_1");
  });
});

describe("readInstructions", () => {
  it("鍵の範囲の外は1件も読ませない", async () => {
    const { repo } = makeRepo([detail("z", { instruction: published() })]);
    const { tokens } = makeTokens(tokenRecord());
    const result = await readInstructions(["z"], tokenRecord(), { ...deps(repo), tokens }, NOW);
    expect(result.items).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain("この鍵では読めません");
    // 範囲外は DB まで見に行かない
    expect(repo.findManyByIds).toHaveBeenCalledWith([]);
  });

  it("未発行・取り下げ済みは、管理画面にあっても読ませない", async () => {
    const { repo } = makeRepo([
      detail("a", { instruction: null }),
      detail("b", { instruction: published({ state: "withdrawn" }) }),
    ]);
    const { tokens } = makeTokens(tokenRecord());
    const result = await readInstructions(["a", "b"], tokenRecord(), { ...deps(repo), tokens }, NOW);
    expect(result.items).toHaveLength(0);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      "この要望の指示文は発行されていません。",
      "この要望の指示文は発行されていません。",
    ]);
    expect(repo.markFetched).not.toHaveBeenCalled();
  });

  it("消された要望は、その旨を返して他の件は読ませる", async () => {
    const { repo } = makeRepo([detail("b", { instruction: published() })]);
    const { tokens } = makeTokens(tokenRecord());
    const result = await readInstructions(["a", "b"], tokenRecord(), { ...deps(repo), tokens }, NOW);
    expect(result.items.map((i) => i.id)).toEqual(["b"]);
    expect(result.skipped[0]).toEqual({
      id: "a",
      reason: "この要望は見つかりません（削除された可能性があります）。",
    });
  });

  it("読めた件は取込済みにし、鍵の名前で記録に残す", async () => {
    const { repo } = makeRepo([
      detail("a", { instruction: published() }),
      detail("b", { instruction: published({ version: 2 }) }),
    ]);
    const { tokens, touch } = makeTokens(tokenRecord());
    await readInstructions(["a", "b"], tokenRecord(), { ...deps(repo), tokens }, NOW);
    expect(repo.markFetched).toHaveBeenCalledWith(["a", "b"]);
    const audit = (repo.appendAudit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      action: string;
      actorId: string | null;
      actorName: string;
    }[];
    expect(audit.map((a) => a.action)).toEqual(["instruction_fetch", "instruction_fetch"]);
    // 読みに来るのは人ではなく鍵なので、actorId は残らず名前で追う
    expect(audit[0]?.actorId).toBeNull();
    // 「開発者」か「CI」かまで残す。どちらの主体が状態を動かしたのかを
    // 後から数え分けられないと、CI が勝手に閉じた件を見つけられない。
    expect(audit[0]?.actorName).toBe("鍵(開発者): 2件を渡すための鍵");
    expect(touch).toHaveBeenCalledWith("tok_1");
  });

  it("1件も読めなければ記録も付けない（空の記録を積まない）", async () => {
    const { repo } = makeRepo([]);
    const { tokens, touch } = makeTokens(tokenRecord());
    await readInstructions(["a"], tokenRecord(), { ...deps(repo), tokens }, NOW);
    expect(repo.markFetched).not.toHaveBeenCalled();
    expect(repo.appendAudit).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
  });

  it("優先度の高い順に並べる（どれから直すかを読み手に判断させない）", async () => {
    const bug = detail("a", {
      instruction: published(),
      diagnostics: diagnostics({
        errors: [{ kind: "uncaught", message: "boom", stack: null, source: null, at: "1" }],
      }),
    });
    const usability = detail("b", { instruction: published() });
    const { repo } = makeRepo([usability, bug]);
    const { tokens } = makeTokens(tokenRecord());
    const result = await readInstructions(["b", "a"], tokenRecord(), { ...deps(repo), tokens }, NOW);
    expect(result.items.map((i) => i.structured.priority)).toEqual(["高", "低"]);
  });

  it("版は保存してある値を使う（読むたびに勝手に上がらない）", async () => {
    const { repo } = makeRepo([detail("a", { instruction: published({ version: 4 }) })]);
    const { tokens } = makeTokens(tokenRecord());
    const result = await readInstructions(["a"], tokenRecord(), { ...deps(repo), tokens }, NOW);
    expect(result.items[0]?.version).toBe(4);
    expect(result.items[0]?.markdown).toContain("| 指示文の版 | v4 |");
  });
});

describe("combineMarkdown", () => {
  it("直す順番を先に示し、件ごとに区切る", () => {
    const items = [
      { id: "a", title: "A", markdown: "# A", version: 1, structured: { priority: "高", kind: "不具合" } },
      { id: "b", title: "B", markdown: "# B", version: 1, structured: { priority: "低", kind: "使いやすさ" } },
    ] as Parameters<typeof combineMarkdown>[0];
    const md = combineMarkdown(items);
    expect(md).toContain("# 改善要望 2件（優先度の高い順）");
    expect(md).toContain("## 直す順番");
    expect(md).toContain("1. [優先度 高／不具合] A");
    expect(md).toContain("## 1件目 / 2件");
    expect(md).toContain("## 2件目 / 2件");
  });

  it("0件でも、次に何をすればよいかを書く（無言で空を返さない）", () => {
    const md = combineMarkdown([]);
    expect(md).toContain("渡された改善要望はありません");
    expect(md).toContain("Claude Code に渡す");
  });
});
