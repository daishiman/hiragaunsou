import { describe, expect, it } from "vitest";
import {
  changeSummaryComment,
  issueContentHash,
  parseSyncedFields,
  planIssueSync,
  planSummaryText,
  syncedFieldsOf,
} from "../../src/domain/rules/improvementIssueSync";
import {
  actionRequiresReason,
  closingCommentOf,
  issueExclusionReason,
  lifecycleRequestError,
  purgedCommentOf,
  shouldCloseIssue,
  statusAfter,
} from "../../src/domain/rules/improvementLifecycle";

/**
 * まとめて Issue へ送るときの「何をするか」の決め方と、要望の一生の決まりごと。
 *
 * 通信をしない層なので、ここで冪等性の芯を固定できる。
 * 「同じものを2回押しても増えない」「変わっていなければ送らない」は、
 * 通信のモックではなくこの計画の段階で保証されているべき性質。
 */

function input(over: Partial<Parameters<typeof planIssueSync>[0][number]> = {}) {
  return {
    id: "improve_1",
    screenLabel: "車両別の収支",
    status: "open" as const,
    archivedAt: null,
    githubIssueNumber: null,
    githubIssueState: null,
    storedHash: null,
    nextHash: "指紋A",
    ...over,
  };
}

describe("planIssueSync（押す前に何が起きるかを決める）", () => {
  it("未起票は新規作成、起票済みは更新になる（2本目を作らない）", () => {
    const plan = planIssueSync([
      input({ id: "a" }),
      input({ id: "b", githubIssueNumber: 12, githubIssueState: "open", storedHash: "古い指紋" }),
    ]);
    expect(plan.items.map((i) => i.kind)).toEqual(["create", "update"]);
    expect(plan).toMatchObject({ create: 1, update: 1, skip: 0, excluded: 0 });
  });

  it("前と同じ内容なら何もしない（空の更新で通知だけ増やさない）", () => {
    const plan = planIssueSync([
      input({ githubIssueNumber: 12, githubIssueState: "open", storedHash: "指紋A", nextHash: "指紋A" }),
    ]);
    expect(plan.items[0]?.kind).toBe("skip");
    expect(plan.items[0]?.reason).toContain("変わっていません");
  });

  it("見送り・誤作成・重複・廃棄は、選ばれていても外へ出さない", () => {
    const plan = planIssueSync([
      input({ id: "a", status: "dropped" }),
      input({ id: "b", status: "invalid" }),
      input({ id: "c", status: "duplicate" }),
      input({ id: "d", archivedAt: new Date("2026-08-14T00:00:00.000Z") }),
    ]);
    expect(plan.excluded).toBe(4);
    // 黙って落とさず、行ごとに理由を持たせる。
    expect(plan.items.map((i) => i.reason)).toEqual([
      "見送りのため送りません",
      "誤作成のため送りません",
      "重複のため送りません",
      "廃棄済みのため送りません",
    ]);
  });

  it("廃棄は状態より優先して対象外になる（廃棄した未対応の件も送らない）", () => {
    expect(
      issueExclusionReason({ status: "open", archivedAt: new Date("2026-08-14T00:00:00.000Z") }),
    ).toBe("廃棄済みのため送りません");
  });

  it("GitHub 側で消された Issue は、未起票として立て直す", () => {
    const plan = planIssueSync([input({ githubIssueNumber: 9, githubIssueState: "missing" })]);
    expect(plan.items[0]?.kind).toBe("create");
    expect(plan.items[0]?.issueNumber).toBeNull();
    expect(plan.items[0]?.reason).toContain("見つからない");
  });

  it("閉じている Issue も、開き直さずに本文だけ更新する対象になる", () => {
    const plan = planIssueSync([
      input({ githubIssueNumber: 12, githubIssueState: "closed", storedHash: "古い指紋" }),
    ]);
    expect(plan.items[0]?.kind).toBe("update");
  });

  it("内訳の一言に、送らない件も必ず出る", () => {
    const plan = planIssueSync([
      input({ id: "a" }),
      input({ id: "b", status: "dropped" }),
      input({ id: "c", githubIssueNumber: 3, githubIssueState: "open", storedHash: "指紋A" }),
    ]);
    const text = planSummaryText(plan);
    expect(text).toContain("新規作成 1件");
    expect(text).toContain("変更なしのため送らない 1件");
    expect(text).toContain("対象外 1件");
  });
});

describe("issueContentHash（内容が変わったかの指紋）", () => {
  const draft = { title: "件名", body: "本文", labels: ["改善要望", "車両別の収支"] };

  it("同じ内容なら同じ指紋になる", async () => {
    expect(await issueContentHash(draft)).toBe(await issueContentHash({ ...draft }));
  });

  it("ラベルの並び順が違うだけでは、変わったことにしない", async () => {
    expect(await issueContentHash(draft)).toBe(
      await issueContentHash({ ...draft, labels: ["車両別の収支", "改善要望"] }),
    );
  });

  it("本文が1文字でも変われば指紋が変わる", async () => {
    expect(await issueContentHash(draft)).not.toBe(
      await issueContentHash({ ...draft, body: "本文。" }),
    );
  });
});

describe("changeSummaryComment（何が変わったかを Issue に残す）", () => {
  const base = syncedFieldsOf({
    status: "open",
    handledNote: null,
    screenLabel: "車両別の収支",
    archivedAt: null,
  });

  it("状況が変わったら、前と後を並べて書く", () => {
    const text = changeSummaryComment(base, { ...base, status: "doing" }, "管理者");
    expect(text).toContain("未対応");
    expect(text).toContain("対応中");
    expect(text).toContain("更新した人: 管理者");
  });

  it("対応メモを消したことも書き残す（黙って消えない）", () => {
    const text = changeSummaryComment({ ...base, handledNote: "様子見" }, base, "管理者");
    expect(text).toContain("（消しました）");
  });

  it("前回の控えが無くても、更新したことだけは書く", () => {
    expect(changeSummaryComment(null, base, "")).toContain("本文を更新しました");
  });

  it("壊れた控えは読み捨てる（画面を落とさない）", () => {
    expect(parseSyncedFields("{壊れている")).toBeNull();
    expect(parseSyncedFields(null)).toBeNull();
  });
});

describe("要望の一生の決まりごと", () => {
  it("見送り・誤作成・重複には理由が要る", () => {
    expect(actionRequiresReason("drop")).toBe(true);
    expect(actionRequiresReason("invalid")).toBe(true);
    expect(actionRequiresReason("duplicate")).toBe(true);
    // 廃棄は戻せるので、理由が無くても止めない。
    expect(actionRequiresReason("archive")).toBe(false);
    expect(actionRequiresReason("restore")).toBe(false);
    // 完全削除は戻せないので必ず要る。
    expect(actionRequiresReason("purge")).toBe(true);
  });

  it("廃棄・復元・完全削除は状態を書き換えない（元が何だったか残る）", () => {
    expect(statusAfter("archive")).toBeNull();
    expect(statusAfter("restore")).toBeNull();
    expect(statusAfter("purge")).toBeNull();
    expect(statusAfter("drop")).toBe("dropped");
  });

  it("直さないと決めたもの・廃棄したものは、Issue を閉じる", () => {
    expect(shouldCloseIssue("dropped", false)).toBe(true);
    expect(shouldCloseIssue("invalid", false)).toBe(true);
    expect(shouldCloseIssue("duplicate", false)).toBe(true);
    expect(shouldCloseIssue("open", true)).toBe(true);
    expect(shouldCloseIssue("doing", false)).toBe(false);
  });

  it("重複で閉じるときは、まとめ先の番号をコメントに載せる", () => {
    const text = closingCommentOf({
      status: "duplicate",
      archived: false,
      reason: "同じ話のため",
      parentIssueNumber: 8,
      actorName: "管理者",
    });
    expect(text).toContain("まとめ先: #8");
    expect(text).toContain("同じ話のため");
  });

  it("完全削除のコメントは、元が無いこととリンクが死ぬことを両方書く", () => {
    const text = purgedCommentOf({ actorName: "管理者", reason: "本人からの依頼" });
    expect(text).toContain("完全に削除されました");
    expect(text).toContain("開いても見つかりません");
    expect(text).toContain("本人からの依頼");
  });

  it("完全削除は、画面で数えた件数と合わなければ受け付けない", () => {
    expect(
      lifecycleRequestError({ action: "purge", ids: ["a", "b"], reason: "依頼", confirmCount: 2 }),
    ).toBeNull();
    expect(
      lifecycleRequestError({ action: "purge", ids: ["a", "b"], reason: "依頼", confirmCount: 1 }),
    ).toContain("一致しません");
  });

  it("重複のまとめ先に、自分自身は指定できない", () => {
    expect(
      lifecycleRequestError({
        action: "duplicate",
        ids: ["a"],
        reason: "同じ話",
        duplicateOfId: "a",
      }),
    ).toContain("選んだ要望そのもの");
  });

  it("上限を超えた一括は、黙って切らずに断る", () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id_${i}`);
    expect(lifecycleRequestError({ action: "archive", ids })).toContain("50件");
  });
});
