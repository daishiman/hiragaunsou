import { describe, expect, it } from "vitest";
import {
  applyHandoffEvent,
  handoffEventLabel,
  HANDOFF_EVENTS,
  isHandoffEvent,
  parsePrReference,
} from "../../src/domain/rules/instructionHandoff";
import {
  CI_ABILITIES,
  DEVELOPER_ABILITIES,
  parseAbilities,
  readRejection,
  statusChangeRejection,
  tokenActorName,
  tokenCompanyRejection,
  type TokenRecord,
} from "../../src/domain/rules/instructionAccess";

function token(over: Partial<TokenRecord> = {}): TokenRecord {
  return {
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    revokedAt: null,
    scopeIds: ["improve_1"],
    abilities: [...DEVELOPER_ABILITIES],
    companyId: null,
    ...over,
  };
}

describe("鍵にできること", () => {
  it("列が無かった頃の鍵は「読むだけ」として扱う（足した列で権限が増えない）", () => {
    expect(parseAbilities(null)).toEqual(["read"]);
    expect(parseAbilities("")).toEqual(["read"]);
  });

  it("壊れた値・空の配列は、何でもできる側ではなく一番弱い側へ倒す", () => {
    expect(parseAbilities("これはJSONではない")).toEqual(["read"]);
    expect(parseAbilities("[]")).toEqual(["read"]);
    expect(parseAbilities('["知らない権限"]')).toEqual(["read"]);
    expect(parseAbilities('{"read":true}')).toEqual(["read"]);
  });

  it("知らない権限が混ざっていても、知っているものだけを拾う", () => {
    expect(parseAbilities('["read","なんでもできる","status:own"]')).toEqual([
      "read",
      "status:own",
    ]);
  });

  it("CI 用の鍵は指示文を読めない（Secrets が漏れても要望の中身は出ない）", () => {
    const ci = token({ abilities: [...CI_ABILITIES] });
    expect(readRejection(ci)).toContain("読めません");
    expect(readRejection(token())).toBeNull();
  });

  it("手元の開発者用の鍵は、自分が取得した件しか進められない", () => {
    expect(statusChangeRejection(token(), true)).toBeNull();
    expect(statusChangeRejection(token(), false)).toContain("取得していない要望");
  });

  it("CI 用の鍵は、取得していなくても進められる（PR のマージを伝えるため）", () => {
    const ci = token({ abilities: [...CI_ABILITIES] });
    expect(statusChangeRejection(ci, false)).toBeNull();
  });

  it("読むだけの鍵は状態を変えられない", () => {
    expect(statusChangeRejection(token({ abilities: ["read"] }), true)).toContain(
      "状態を変えられません",
    );
  });

  it("どちらの主体による更新かが記録に残る", () => {
    expect(tokenActorName({ id: "tok_1", name: "手元", abilities: DEVELOPER_ABILITIES })).toBe(
      "鍵(開発者): 手元",
    );
    expect(tokenActorName({ id: "tok_2", name: "CI", abilities: CI_ABILITIES })).toBe("鍵(CI): CI");
    // 名前が空でも、id で追えるようにしておく
    expect(tokenActorName({ id: "tok_3", name: "", abilities: DEVELOPER_ABILITIES })).toBe(
      "鍵(開発者): tok_3",
    );
  });
});

describe("会社の境界（マルチテナント化時の掛け金）", () => {
  it("単一の会社しか無いいまは素通りする", () => {
    expect(tokenCompanyRejection(token(), null)).toBeNull();
    expect(tokenCompanyRejection(token({ companyId: "c1" }), null)).toBeNull();
  });

  it("会社を持たせたときは、違う会社の要望を弾く", () => {
    expect(tokenCompanyRejection(token({ companyId: "c1" }), "c1")).toBeNull();
    expect(tokenCompanyRejection(token({ companyId: "c1" }), "c2")).toContain("扱えない要望");
  });
});

describe("直り終わるまでの状態の進み方", () => {
  it("取得したら未対応から対応中へ進む", () => {
    expect(applyHandoffEvent("open", "fetched").nextStatus).toBe("doing");
  });

  it("取り直しても巻き戻さない（直したあとに読み返すことがある）", () => {
    expect(applyHandoffEvent("review", "fetched").nextStatus).toBeNull();
    expect(applyHandoffEvent("done", "fetched").nextStatus).toBeNull();
  });

  it("確認依頼を作ったらレビュー待ち、マージしたら対応済み", () => {
    const pr = { url: "https://github.com/a/b/pull/12", number: 12 };
    const opened = applyHandoffEvent("doing", "pr_opened", pr);
    expect(opened.nextStatus).toBe("review");
    expect(opened.pr).toEqual(pr);

    expect(applyHandoffEvent("review", "pr_merged", pr).nextStatus).toBe("done");
  });

  it("確認依頼を取り下げたら対応中へ戻し、控えも消す", () => {
    const closed = applyHandoffEvent("review", "pr_closed");
    expect(closed.nextStatus).toBe("doing");
    // 控えを残すと、次に作る確認依頼と取り違える
    expect(closed.pr).toBeNull();
  });

  it("人が理由を書いて脇へ寄せた件は、機械が引き戻さない", () => {
    for (const parked of ["dropped", "invalid", "duplicate"] as const) {
      for (const event of HANDOFF_EVENTS) {
        const outcome = applyHandoffEvent(parked, event);
        expect(outcome.nextStatus).toBeNull();
        // 何も起きなかったことにはしない。記録には残す。
        expect(outcome.reason).toContain(handoffEventLabel(event));
      }
    }
  });

  it("扱う出来事は4つだけ（知らない言葉で状態を動かせない）", () => {
    expect(isHandoffEvent("pr_merged")).toBe(true);
    expect(isHandoffEvent("done")).toBe(false);
    expect(isHandoffEvent("")).toBe(false);
  });
});

describe("確認依頼の指し先", () => {
  it("GitHub の PR の形だけを受け取り、番号は URL から読み直す", () => {
    expect(parsePrReference("https://github.com/daishiman/hiragaunsou/pull/42", 42)).toEqual({
      url: "https://github.com/daishiman/hiragaunsou/pull/42",
      number: 42,
    });
    // 番号を書かなくても URL から決まる
    expect(parsePrReference("https://github.com/a/b/pull/7", undefined)?.number).toBe(7);
  });

  it("番号と URL が食い違うものは受け取らない", () => {
    expect(parsePrReference("https://github.com/a/b/pull/7", 8)).toBeNull();
  });

  it("管理画面のリンクになるので、任意の行き先は通さない", () => {
    for (const bad of [
      "https://example.com/pull/1",
      "javascript:alert(1)",
      "http://github.com/a/b/pull/1",
      "https://github.com/a/b/issues/1",
      "https://github.com.evil.test/a/b/pull/1",
      "",
      null,
      42,
    ]) {
      expect(parsePrReference(bad, undefined)).toBeNull();
    }
  });
});
