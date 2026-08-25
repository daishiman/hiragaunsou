import { describe, expect, it } from "vitest";
import {
  changeSummaryText,
  displayStateOf,
  instructionContentHash,
  instructionStateLabel,
  isInstructionState,
  parseSyncedFields,
  planInstructionSync,
  planSummaryText,
  syncedFieldsOf,
  type StoredInstruction,
  type SyncedFields,
} from "../../src/domain/rules/improvementInstructionSync";
import type { ImprovementStatus } from "../../src/domain/rules/improvement";

/**
 * 「同じものを2回押しても指示文が2つにならない」の1段目 (計画) を固定する。
 *
 * ここが崩れると、押すたびに版だけが上がって Claude Code 側に同じ話が何度も届く。
 * 実行時の指紋判定とリースは別テストで見ているので、ここでは
 * 「押す前に見せる内訳が、実際に起きることと一致しているか」に絞る。
 */

function stored(over: Partial<StoredInstruction> = {}): StoredInstruction {
  return {
    version: 1,
    hash: "h1",
    state: "published",
    syncedFields: null,
    publishedAt: new Date("2026-08-01T00:00:00Z"),
    fetchedAt: null,
    ...over,
  };
}

function input(over: Partial<Parameters<typeof planInstructionSync>[0][number]> = {}) {
  return {
    id: "req_1",
    screenLabel: "月次収支表",
    status: "open" as ImprovementStatus,
    archivedAt: null,
    instruction: null as StoredInstruction | null,
    nextHash: "h2",
    ...over,
  };
}

describe("指示文の状態", () => {
  it("保存する状態は3つだけで、表示用の呼び名は状態ごとに違う", () => {
    expect(isInstructionState("published")).toBe(true);
    expect(isInstructionState("fetched")).toBe(true);
    expect(isInstructionState("withdrawn")).toBe(true);
    expect(isInstructionState("done")).toBe(false);
    expect(isInstructionState("")).toBe(false);

    const labels = (["none", "published", "outdated", "fetched", "done", "excluded"] as const).map(
      instructionStateLabel,
    );
    expect(labels).toEqual(["未発行", "発行済み", "更新あり", "取込済み", "対応完了", "対象外"]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("一覧に出す状態 (displayStateOf)", () => {
  const base = {
    status: "open" as ImprovementStatus,
    archivedAt: null as Date | null,
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    instruction: null as StoredInstruction | null,
  };

  it("対応済みは、発行の有無に関わらず対応完了として出す", () => {
    expect(displayStateOf({ ...base, status: "done" })).toBe("done");
    expect(displayStateOf({ ...base, status: "done", instruction: stored() })).toBe("done");
  });

  it("見送り・誤作成・重複・廃棄は対象外として出す", () => {
    for (const status of ["dropped", "invalid", "duplicate"] as const) {
      expect(displayStateOf({ ...base, status })).toBe("excluded");
    }
    expect(displayStateOf({ ...base, archivedAt: new Date("2026-08-02T00:00:00Z") })).toBe(
      "excluded",
    );
  });

  it("未発行と、取り下げ済みは同じ「未発行」に見せる", () => {
    expect(displayStateOf(base)).toBe("none");
    expect(displayStateOf({ ...base, instruction: stored({ state: "withdrawn" }) })).toBe("none");
  });

  it("発行後に要望が更新されていれば「更新あり」", () => {
    const row = {
      ...base,
      updatedAt: new Date("2026-08-03T00:00:00Z"),
      instruction: stored({ publishedAt: new Date("2026-08-01T00:00:00Z") }),
    };
    expect(displayStateOf(row)).toBe("outdated");
  });

  it("更新時刻が発行時刻と同じなら「更新あり」にしない (押した直後に更新扱いにしない)", () => {
    const at = new Date("2026-08-01T00:00:00Z");
    expect(displayStateOf({ ...base, updatedAt: at, instruction: stored({ publishedAt: at }) })).toBe(
      "published",
    );
  });

  it("取り込まれていれば取込済み。発行時刻が無ければ更新ありにはしない", () => {
    expect(displayStateOf({ ...base, instruction: stored({ state: "fetched" }) })).toBe("fetched");
    expect(
      displayStateOf({
        ...base,
        updatedAt: new Date("2026-09-01T00:00:00Z"),
        instruction: stored({ publishedAt: null, state: "fetched" }),
      }),
    ).toBe("fetched");
  });
});

describe("内容の指紋 (instructionContentHash)", () => {
  it("題と本文が同じなら同じ、どちらかが変われば変わる", async () => {
    const a = await instructionContentHash({ title: "t", markdown: "m" } as never);
    const b = await instructionContentHash({ title: "t", markdown: "m" } as never);
    const c = await instructionContentHash({ title: "t2", markdown: "m" } as never);
    const d = await instructionContentHash({ title: "t", markdown: "m2" } as never);

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("発行した時点の控え (syncedFields)", () => {
  it("廃棄は日時ではなく有無だけを持つ", () => {
    expect(
      syncedFieldsOf({
        status: "doing",
        handledNote: "対応中",
        screenLabel: "月次収支表",
        archivedAt: new Date("2026-08-01T00:00:00Z"),
      }),
    ).toEqual({ status: "doing", handledNote: "対応中", screenLabel: "月次収支表", archived: true });

    expect(
      syncedFieldsOf({ status: "open", handledNote: null, screenLabel: "車両別", archivedAt: null }),
    ).toEqual({ status: "open", handledNote: null, screenLabel: "車両別", archived: false });
  });

  it("壊れた控えを読んでも例外にせず null を返す (発行が止まらないように)", () => {
    expect(parseSyncedFields(null)).toBeNull();
    expect(parseSyncedFields("")).toBeNull();
    expect(parseSyncedFields("{壊れている")).toBeNull();
    expect(parseSyncedFields(JSON.stringify({ status: "open" }))).toBeNull();
    expect(parseSyncedFields(JSON.stringify({ screenLabel: "月次収支表" }))).toBeNull();
  });

  it("欠けている値は既定に寄せて読む", () => {
    expect(parseSyncedFields(JSON.stringify({ status: "open", screenLabel: "月次収支表" }))).toEqual(
      { status: "open", handledNote: null, screenLabel: "月次収支表", archived: false },
    );
    expect(
      parseSyncedFields(
        JSON.stringify({ status: "open", screenLabel: "月次", handledNote: 12, archived: "yes" }),
      ),
    ).toEqual({ status: "open", handledNote: null, screenLabel: "月次", archived: false });
  });
});

describe("前の版からの変更点 (changeSummaryText)", () => {
  const after: SyncedFields = {
    status: "doing",
    handledNote: "直しています",
    screenLabel: "月次収支表",
    archived: false,
  };

  it("控えが無いときは作り直した旨だけを書く", () => {
    const text = changeSummaryText(null, after, "山田");
    expect(text).toContain("管理画面の内容に合わせて指示文を作り直しました。");
    expect(text).toContain("更新した人: 山田");
  });

  it("名前が空でも「管理者」として誰が更新したかを必ず残す", () => {
    expect(changeSummaryText(null, after, "")).toContain("更新した人: 管理者");
  });

  it("状況の変化は画面の呼び名で書く (DBの値は出さない)", () => {
    const text = changeSummaryText({ ...after, status: "open" }, after, "山田");
    expect(text).toContain("- 状況: 未対応 → **対応中**");
    expect(text).not.toContain("doing");
  });

  it("対応メモは、書いたときと消したときで書き分ける", () => {
    expect(changeSummaryText({ ...after, handledNote: null }, after, "山田")).toContain(
      "- 対応メモ: 直しています",
    );
    expect(
      changeSummaryText(after, { ...after, handledNote: null }, "山田"),
    ).toContain("- 対応メモ: （消しました）");
    expect(changeSummaryText(after, { ...after, handledNote: "  " }, "山田")).toContain(
      "- 対応メモ: （消しました）",
    );
  });

  it("廃棄と、廃棄から戻したことを書き分ける", () => {
    expect(changeSummaryText(after, { ...after, archived: true }, "山田")).toContain(
      "- 廃棄しました",
    );
    expect(changeSummaryText({ ...after, archived: true }, after, "山田")).toContain(
      "- 廃棄から戻しました",
    );
  });

  it("画面が変われば前後を書く", () => {
    expect(changeSummaryText({ ...after, screenLabel: "車両別" }, after, "山田")).toContain(
      "- 画面: 車両別 → 月次収支表",
    );
  });

  it("控えと同じでも、何も書かない版にはしない", () => {
    expect(changeSummaryText(after, after, "山田")).toContain("- 内容を最新に更新しました。");
  });

  it("複数の変化はすべて並べる", () => {
    const before: SyncedFields = {
      status: "open",
      handledNote: null,
      screenLabel: "車両別",
      archived: true,
    };
    const text = changeSummaryText(before, after, "山田");
    expect(text.split("\n")).toHaveLength(5);
  });
});

describe("何をするかの計画 (planInstructionSync)", () => {
  it("未発行は新規発行、取り下げ済みは出し直しとして版を上げる", () => {
    const plan = planInstructionSync([
      input({ id: "a" }),
      input({ id: "b", instruction: stored({ state: "withdrawn", version: 3 }) }),
    ]);

    expect(plan.items[0]).toMatchObject({
      id: "a",
      kind: "publish",
      version: 1,
      reason: "指示文を新しく発行します",
    });
    expect(plan.items[1]).toMatchObject({
      id: "b",
      kind: "publish",
      version: 4,
      reason: "取り下げていた指示文を、新しい版で出し直します",
    });
  });

  it("指紋が同じなら何もしない (2回押しても版が上がらない)", () => {
    const plan = planInstructionSync([
      input({ instruction: stored({ hash: "h2", version: 2 }), nextHash: "h2" }),
    ]);
    expect(plan.items[0]).toMatchObject({
      kind: "skip",
      version: 2,
      reason: "v2 から内容が変わっていません",
    });
  });

  it("指紋が無い過去の行は、内容が変わったものとして更新する", () => {
    const plan = planInstructionSync([
      input({ instruction: stored({ hash: null, version: 2 }), nextHash: "h9" }),
    ]);
    expect(plan.items[0]).toMatchObject({
      kind: "revise",
      version: 3,
      reason: "内容が変わったので v2 → v3 に更新します",
    });
  });

  it("対象外の4種は、選ばれていても理由つきで残す (黙って減らさない)", () => {
    const plan = planInstructionSync([
      input({ id: "arch", archivedAt: new Date("2026-08-01T00:00:00Z") }),
      input({ id: "drop", status: "dropped" }),
      input({ id: "inv", status: "invalid" }),
      input({ id: "dup", status: "duplicate", instruction: stored({ version: 5 }) }),
    ]);

    expect(plan.items.map((i) => i.kind)).toEqual(["excluded", "excluded", "excluded", "excluded"]);
    expect(plan.items.map((i) => i.reason)).toEqual([
      "廃棄済みのため渡しません",
      "見送りのため渡しません",
      "誤作成のため渡しません",
      "重複のため渡しません",
    ]);
    // 対象外は版を進めない (発行済みの版はそのまま見せる)
    expect(plan.items.map((i) => i.version)).toEqual([0, 0, 0, 5]);
  });

  it("渡された順を保ち、内訳の件数は種別ごとに数える", () => {
    const plan = planInstructionSync([
      input({ id: "a" }),
      input({ id: "b", instruction: stored({ hash: "h2" }), nextHash: "h2" }),
      input({ id: "c", instruction: stored({ hash: "old" }) }),
      input({ id: "d", status: "dropped" }),
    ]);

    expect(plan.items.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(plan).toMatchObject({ publish: 1, skip: 1, revise: 1, excluded: 1 });
  });

  it("0件でも計画は成立する", () => {
    expect(planInstructionSync([])).toEqual({
      items: [],
      publish: 0,
      revise: 0,
      skip: 0,
      excluded: 0,
    });
  });
});

describe("押す前に見せる一言 (planSummaryText)", () => {
  it("対象外が無いときは3つだけを出す", () => {
    const text = planSummaryText({ items: [], publish: 2, revise: 1, skip: 3, excluded: 0 });
    expect(text).toBe("新しく発行 2件 / 内容を更新 1件 / 変更なしのため何もしない 3件");
  });

  it("対象外があるときだけ4つ目を足す", () => {
    const text = planSummaryText({ items: [], publish: 0, revise: 0, skip: 0, excluded: 2 });
    expect(text).toContain("対象外 2件");
  });
});
