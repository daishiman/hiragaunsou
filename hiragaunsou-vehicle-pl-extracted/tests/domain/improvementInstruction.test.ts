import { describe, expect, it } from "vitest";
import {
  acceptanceCriteriaOf,
  buildInstruction,
  endpointOf,
  instructionKindOf,
  instructionPriorityOf,
  instructionTitleOf,
} from "../../src/domain/rules/improvementInstruction";
import type { StoredDiagnostics, NetworkEntry } from "../../src/domain/rules/diagnostics";
import type { ImprovementDetail } from "../../src/domain/repositories/ImprovementRepository";

/**
 * Claude Code に渡す指示文の中身。
 *
 * 満たすべき条件は2つで、検査もその2つに絞る。
 *   1. これだけ読んで着手できること（受け入れ条件が必ず入る）
 *   2. コピーされて持ち出されても困らないこと（認証情報・連絡先が出ない）
 *
 * 2つ目は「外部サービスへ出さなくなったから緩めてよい」ものではない。
 * 貼り付け先はこちらで決められないので、値の形をした秘密はここで落とす。
 */

const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

function network(over: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    method: "GET",
    url: `${ORIGIN}/api/vehicles/1177/monthly?year=2026`,
    status: 500,
    durationMs: 320,
    requestId: "req-1",
    cfRay: "ray-1",
    responseExcerpt: null,
    at: "2026-08-15 10:00:00",
    ok: false,
    ...over,
  };
}

function diagnostics(over: Partial<StoredDiagnostics> = {}): StoredDiagnostics {
  return {
    version: 1,
    referrer: "/grid",
    build: { id: "abc123@2026-08-15", commit: "abc123" },
    environment: {
      userAgent: "Mozilla/5.0 ...",
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
      path: "/vehicle/1177?ym=2026-05",
      routePattern: "/vehicle/[vehicleNo]",
      label: "車両別の収支",
      sourceFile: "app/(app)/vehicle/[vehicleNo]/page.tsx",
    },
    reporter: {
      id: "u1",
      name: "入力担当",
      role: "input_staff",
      companyId: "（1社専用のため会社IDなし）",
    },
    ...over,
  };
}

function detail(over: Partial<ImprovementDetail> = {}): ImprovementDetail {
  return {
    id: "improve_abc",
    status: "open",
    path: "/vehicle/1177?ym=2026-05",
    routePattern: "/vehicle/[vehicleNo]",
    screenLabel: "車両別の収支",
    body: "合計が右端で切れて読めません。",
    reporterName: "入力担当",
    handledNote: null,
    hasShot: true,
    instruction: null,
    archivedAt: null,
    duplicateOfId: null,
    createdAt: new Date("2026-08-15T01:00:00.000Z"),
    updatedAt: new Date("2026-08-15T01:00:00.000Z"),
    viewport: "1440×900",
    userAgent: "Mozilla/5.0 ...",
    shot: "data:image/jpeg;base64,AAAA",
    handledByName: null,
    handledAt: null,
    diagnostics: diagnostics(),
    ...over,
  };
}

const options = { appOrigin: ORIGIN, shotUrl: `${ORIGIN}/api/instructions/shot/improve_abc?exp=1&sig=x`, version: 3 };

describe("instructionKindOf（種類は申告ではなく診断情報で決める）", () => {
  it("例外が出ていれば、文面が要望調でも不具合", () => {
    const d = diagnostics({
      errors: [
        { kind: "uncaught", message: "x is not a function", stack: null, source: null, at: "1" },
      ],
    });
    expect(instructionKindOf(d)).toBe("不具合");
  });

  it("5xx や通信不成立も不具合", () => {
    expect(instructionKindOf(diagnostics({ network: [network({ status: 500 })] }))).toBe("不具合");
    expect(instructionKindOf(diagnostics({ network: [network({ status: null })] }))).toBe("不具合");
  });

  it("4xx だけなら要調査（利用者の入力かもしれず、断定しない）", () => {
    expect(instructionKindOf(diagnostics({ network: [network({ status: 400 })] }))).toBe("要調査");
  });

  it("裏で何も起きていなければ使いやすさ。診断情報が無い件も同じ扱い", () => {
    expect(instructionKindOf(diagnostics())).toBe("使いやすさ");
    expect(instructionKindOf(null)).toBe("使いやすさ");
  });

  it("優先度は種類から決まる（止まっているものが先）", () => {
    expect(instructionPriorityOf("不具合")).toBe("高");
    expect(instructionPriorityOf("要調査")).toBe("中");
    expect(instructionPriorityOf("使いやすさ")).toBe("低");
  });
});

describe("acceptanceCriteriaOf（直ったと判定できる条件）", () => {
  it("どの種類でも、テスト追加・品質ゲート・preview 確認が必ず入る", () => {
    for (const d of [
      diagnostics({
        errors: [{ kind: "uncaught", message: "boom", stack: null, source: null, at: "1" }],
      }),
      diagnostics({ network: [network({ status: 404 })] }),
      diagnostics(),
      null,
    ]) {
      const kind = instructionKindOf(d);
      const criteria = acceptanceCriteriaOf(detail(), d, kind).join("\n");
      expect(criteria).toContain("直す前のコードでは落ちること");
      expect(criteria).toContain("pnpm run typecheck");
      expect(criteria).toContain("localhost:8787");
    }
  });

  it("不具合は、出ていた例外と失敗した通信がそのまま条件になる", () => {
    const d = diagnostics({
      errors: [
        { kind: "uncaught", message: "cannot read length", stack: null, source: null, at: "1" },
      ],
      network: [network({ status: 500 })],
    });
    const criteria = acceptanceCriteriaOf(detail(), d, "不具合");
    expect(criteria.join("\n")).toContain("cannot read length");
    // 実URLではなく入り口の形で書く（どのAPIかは分かり、どのデータかは分からない）
    expect(criteria.join("\n")).toContain("/api/vehicles/:id/monthly");
    expect(criteria.join("\n")).not.toContain("year=2026");
  });

  it("失敗した通信が多くても条件は3件までに絞る（読み切れない量にしない）", () => {
    const d = diagnostics({
      network: Array.from({ length: 8 }, (_, i) =>
        network({ status: 500, url: `${ORIGIN}/api/x${i}` }),
      ),
    });
    const criteria = acceptanceCriteriaOf(detail(), d, "不具合");
    expect(criteria.filter((c) => c.includes("正常に応答すること"))).toHaveLength(3);
  });

  it("条件の中で場所を「上・下」で指さない（複数件を連結すると上下がずれるため）", () => {
    for (const d of [
      diagnostics({
        errors: [{ kind: "uncaught", message: "boom", stack: null, source: null, at: "1" }],
      }),
      diagnostics({ network: [network({ status: 404 })] }),
      diagnostics(),
      null,
    ]) {
      for (const c of acceptanceCriteriaOf(detail(), d, instructionKindOf(d))) {
        expect(c).not.toMatch(/[上下]の/);
        expect(c).not.toContain("下に挙げた");
      }
    }
  });

  it("使いやすさは、他の画面と作法を揃えることまで条件にする", () => {
    const criteria = acceptanceCriteriaOf(detail(), diagnostics(), "使いやすさ").join("\n");
    expect(criteria).toContain("入力の作法");
    expect(criteria).toContain("現在地・退避先の固定表示");
  });
});

describe("endpointOf（実URLからデータを落とす）", () => {
  it("数字・長いID・年月は :id にする", () => {
    expect(endpointOf(`${ORIGIN}/api/vehicles/1177/monthly?year=2026`)).toBe(
      "/api/vehicles/:id/monthly",
    );
    expect(endpointOf("/api/improvements/2026-05")).toBe("/api/improvements/:id");
    expect(endpointOf("/api/x/0123456789abcdef0123")).toBe("/api/x/:id");
  });

  it("パスとして読めないものは取得不可に倒す", () => {
    expect(endpointOf("javascript:alert(1)")).toBe("取得不可");
  });
});

describe("buildInstruction（指示文の本体）", () => {
  it("これだけ読んで着手できる項目が揃っている", () => {
    const built = buildInstruction(detail(), options);
    expect(built.markdown).toContain("車両別の収支");
    expect(built.markdown).toContain("`/vehicle/[vehicleNo]`");
    expect(built.markdown).toContain("app/(app)/vehicle/[vehicleNo]/page.tsx");
    expect(built.markdown).toContain("## 受け入れ条件");
    expect(built.markdown).toContain("## 再現手順");
    expect(built.markdown).toContain("## やらないこと");
    expect(built.markdown).toContain("| 指示文の版 | v3 |");
    expect(built.markdown).toContain(`${ORIGIN}/admin/improvements/improve_abc`);
  });

  it("利用者が書いたことは要約せず、そのまま引用する", () => {
    const built = buildInstruction(detail({ body: "合計が\n右端で切れます。" }), options);
    expect(built.markdown).toContain("> 合計が\n> 右端で切れます。");
  });

  it("画像は期限付きURLで載せ、黒塗りが元に戻せないことを書き添える", () => {
    const built = buildInstruction(detail(), options);
    expect(built.markdown).toContain(options.shotUrl);
    expect(built.markdown).toContain("元の内容は残っていません");
  });

  it("画像が無い件では、あるように書かない", () => {
    const built = buildInstruction(detail({ hasShot: false }), options);
    expect(built.markdown).toContain("画像は付いていません");
    expect(built.structured.shotUrl).toBeNull();
  });

  it("画像はあるがURLを用意できないときは、管理画面へ案内する", () => {
    const built = buildInstruction(detail(), { ...options, shotUrl: null });
    expect(built.markdown).toContain("この指示文からは開けません");
    expect(built.markdown).toContain(`${ORIGIN}/admin/improvements/improve_abc`);
  });

  it("診断情報が無い件でも、無いことを書いて成立させる（欠測を空欄にしない）", () => {
    const built = buildInstruction(detail({ diagnostics: null }), options);
    expect(built.markdown).toContain("診断情報が付いていません");
    expect(built.structured.environment).toBeNull();
    expect(built.structured.occurredAt.jst).toBe("取得不可");
  });

  it("再現手順は足あとの順に並び、入力した値そのものは出さない", () => {
    const built = buildInstruction(
      detail({
        diagnostics: diagnostics({
          breadcrumbs: [
            { kind: "navigate", target: "/grid", at: "10:00:00" },
            { kind: "input", target: "#ym", at: "10:00:05" },
            { kind: "click", target: "button.確定", at: "10:00:09" },
          ],
        }),
      }),
      options,
    );
    expect(built.structured.reproduction).toEqual([
      "`/grid` を開く — 10:00:00",
      "`#ym` に入力 — 10:00:05",
      "`button.確定` を押す — 10:00:09",
    ]);
    expect(built.markdown).toContain("入力した値そのものは記録していません");
  });

  it("Markdown と structured は同じ内容から作る（片方だけ古くならない）", () => {
    const built = buildInstruction(detail(), options);
    expect(built.structured.title).toBe(built.title);
    expect(built.markdown.startsWith(`# ${built.title}`)).toBe(true);
    expect(built.structured.acceptance.length).toBeGreaterThan(0);
    for (const c of built.structured.acceptance) expect(built.markdown).toContain(`- [ ] ${c}`);
  });
});

describe("持ち出されても困らないこと（マスキング）", () => {
  const leaky = detail({
    body: [
      "連絡は tanaka@hiragaunsou.co.jp か 090-1234-5678 まで。",
      "Authorization: Bearer sk_live_ABCDEFGHIJKLMNOP を使ったら落ちました。",
      "token=abcdef0123456789abcdef もコピーしておきます。",
      "カードは 4111 1111 1111 1111 です。",
    ].join("\n"),
  });

  it("メール・電話・カード番号・鍵は、指示文の本文に出ない", () => {
    const built = buildInstruction(leaky, options);
    for (const secret of [
      "tanaka@hiragaunsou.co.jp",
      "090-1234-5678",
      "sk_live_ABCDEFGHIJKLMNOP",
      "abcdef0123456789abcdef",
      "4111 1111 1111 1111",
    ]) {
      expect(built.markdown).not.toContain(secret);
    }
    expect(built.markdown).toContain("[マスク:");
  });

  it("構造化データ（format=json）にも同じふるいがかかる", () => {
    const built = buildInstruction(leaky, options);
    expect(built.structured.request).not.toContain("tanaka@hiragaunsou.co.jp");
    expect(built.structured.request).not.toContain("090-1234-5678");
    expect(JSON.stringify(built.structured)).not.toContain("sk_live_ABCDEFGHIJKLMNOP");
  });

  it("見出しにもふるいがかかる（一覧やコピー用の1行に漏れない）", () => {
    const title = instructionTitleOf({
      screenLabel: "車両別の収支",
      body: "tanaka@hiragaunsou.co.jp に送れません",
    });
    expect(title).not.toContain("tanaka@hiragaunsou.co.jp");
    expect(title).toContain("車両別の収支");
  });

  it("見出しは1行に収め、長い本文は切る", () => {
    const title = instructionTitleOf({ screenLabel: "月次一覧", body: "あ".repeat(200) });
    expect(title).not.toContain("\n");
    expect(title.length).toBeLessThan(80);
    expect(title).toContain("…");
  });

  it("送った人の氏名とメールは指示文に出さない（直すのに要らない）", () => {
    const built = buildInstruction(detail(), options);
    expect(built.markdown).not.toContain("入力担当");
    expect(JSON.stringify(built.structured)).not.toContain("入力担当");
    // 権限だけは残す。誰の目に触れる不具合かを判断する材料になる。
    expect(built.markdown).toContain("input_staff");
  });
});
