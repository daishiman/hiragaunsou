import { describe, expect, it } from "vitest";
import {
  buildIssueDraft,
  issueLabelsOf,
  issueTitleOf,
} from "../../src/domain/rules/improvementIssue";
import type { StoredDiagnostics } from "../../src/domain/rules/diagnostics";
import type { ImprovementDetail } from "../../src/domain/repositories/ImprovementRepository";

/**
 * 起票する Issue の文面。
 *
 * 満たすべき条件は1つ。「この Issue だけを見て着手できること」。
 * だから検査も「元の要望を見に行かないと分からない項目が欠けていないか」で行う。
 */
const ORIGIN = "https://hiragaunsou-vehicle-pl.daishimanju.workers.dev";

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
    reporter: { id: "u1", name: "入力担当", role: "input_staff", companyId: "（1社専用のため会社IDなし）" },
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
    githubIssueNumber: null,
    createdAt: new Date("2026-08-15T01:00:00.000Z"),
    viewport: "1440×900",
    userAgent: "Mozilla/5.0 ...",
    shot: "data:image/jpeg;base64,AAAA",
    handledByName: null,
    handledAt: null,
    diagnostics: diagnostics(),
    githubIssueUrl: null,
    githubIssuedAt: null,
    ...over,
  };
}

describe("issueTitleOf", () => {
  it("画面名と本文の頭を1行にまとめる", () => {
    expect(issueTitleOf({ screenLabel: "車両別の収支", body: "合計が切れます。" })).toBe(
      "[改善要望] 車両別の収支: 合計が切れます。",
    );
  });

  it("改行を潰し、長い本文は切る（一覧で読める長さにする）", () => {
    const title = issueTitleOf({ screenLabel: "月次", body: `${"あ".repeat(80)}\n続き` });
    expect(title).not.toContain("\n");
    expect(title).toContain("…");
    expect(title.length).toBeLessThan(80);
  });
});

describe("issueLabelsOf", () => {
  it("裏でエラーが出ていれば、本人が「使いにくい」と書いても不具合として扱う", () => {
    const d = diagnostics({
      errors: [{ kind: "uncaught", message: "boom", stack: null, source: null, at: "10:00" }],
    });
    expect(issueLabelsOf(d)).toContain("不具合");
  });

  it("サーバ側の失敗（500・通信できず）も不具合", () => {
    const d = diagnostics({
      network: [
        {
          method: "GET",
          url: "/api/x",
          status: 500,
          durationMs: 10,
          requestId: null,
          cfRay: null,
          responseExcerpt: null,
          at: "10:00",
          ok: false,
        },
      ],
    });
    expect(issueLabelsOf(d)).toContain("不具合");
  });

  it("400番台だけなら、原因を決めつけず要調査にする", () => {
    const d = diagnostics({
      network: [
        {
          method: "POST",
          url: "/api/x",
          status: 400,
          durationMs: 10,
          requestId: null,
          cfRay: null,
          responseExcerpt: null,
          at: "10:00",
          ok: false,
        },
      ],
    });
    expect(issueLabelsOf(d)).toContain("要調査");
  });

  it("何も出ていなければ使いやすさの指摘", () => {
    expect(issueLabelsOf(diagnostics())).toEqual(["改善要望", "使いやすさ"]);
    expect(issueLabelsOf(null)).toEqual(["改善要望", "使いやすさ"]);
  });
});

describe("buildIssueDraft", () => {
  it("着手に要るものが全て載る", () => {
    const { body } = buildIssueDraft(detail(), { appOrigin: ORIGIN, shotUrl: null });

    // 原文（要約しない）
    expect(body).toContain("> 合計が右端で切れて読めません。");
    // どこの話か（実URL は載せない。route pattern だけ）
    expect(body).toContain("/vehicle/[vehicleNo]");
    expect(body).toContain("app/(app)/vehicle/[vehicleNo]/page.tsx");
    // いつ・どの版で
    expect(body).toContain("2026-08-15 10:00:00 JST");
    expect(body).toContain("abc123");
    // 環境
    expect(body).toContain("Chrome 141");
    expect(body).toContain("Windows 11");
    // 元の要望へ戻る道
    expect(body).toContain(`${ORIGIN}/admin/improvements/improve_abc`);
  });

  it("足あとを再現手順として並べる", () => {
    const item = detail({
      diagnostics: diagnostics({
        breadcrumbs: [
          { kind: "navigate", target: "/grid", at: "09:59:00" },
          { kind: "click", target: "button#open-vehicle", at: "09:59:30" },
          { kind: "submit", target: "form#filter", at: "10:00:00" },
        ],
      }),
    });
    const { body } = buildIssueDraft(item, { appOrigin: ORIGIN, shotUrl: null });
    expect(body).toContain("1. `/grid` を開く");
    expect(body).toContain("2. `button#open-vehicle` を押す");
    expect(body).toContain("3. `form#filter` を送信");
  });

  it("画像の置き場が無いときは、Issue に画像を出さず見る場所だけ示す", () => {
    const { body } = buildIssueDraft(detail(), { appOrigin: ORIGIN, shotUrl: null });
    expect(body).not.toContain("data:image/jpeg");
    expect(body).toContain("画像はこちらで確認してください");
  });

  it("画像の置き場があれば Issue から見えるように貼る", () => {
    const { body } = buildIssueDraft(detail(), {
      appOrigin: ORIGIN,
      shotUrl: "https://example.com/shot.jpg",
    });
    expect(body).toContain("![");
    expect(body).toContain("https://example.com/shot.jpg");
  });

  it("長い診断情報は折りたたむ（最初に読む数行を埋めない）", () => {
    const { body } = buildIssueDraft(detail(), { appOrigin: ORIGIN, shotUrl: null });
    expect(body).toContain("<details>");
    expect(body).toContain("<summary>環境（ブラウザ・OS・画面）</summary>");
    expect(body).toContain("<summary>失敗した通信（相関IDつき・サーバのログと突き合わせる用）</summary>");
  });

  /**
   * 外へ出す量は、保存する量より少ない。
   *
   * Issue は編集しても履歴と通知メールが残り、実質取り消せない。読む人の範囲も
   * 管理画面と違う。だから「管理画面では見えるが Issue には出さない」を固定する。
   */
  it("送った人が誰かは Issue に出さない（管理画面でだけ分かる）", () => {
    const { body } = buildIssueDraft(detail(), { appOrigin: ORIGIN, shotUrl: null });

    expect(body).not.toContain("入力担当");
    expect(body).not.toContain("u1");
    expect(body).not.toContain("平賀運送");
    // 立場によって画面の見え方が変わるので、権限だけは残す。
    expect(body).toContain("input_staff");
    // 足りない分をたどれる導線は必ず載せる。
    expect(body).toContain(`${ORIGIN}/admin/improvements/improve_abc`);
  });

  it("実URL は載せない（IDが埋まっていて、どのデータかまで分かってしまう）", () => {
    const { body } = buildIssueDraft(detail(), { appOrigin: ORIGIN, shotUrl: null });
    expect(body).not.toContain("/vehicle/1177");
  });

  it("失敗した通信は、エンドポイントと結果だけ。応答の中身は出さない", () => {
    const item = detail({
      diagnostics: diagnostics({
        network: [
          {
            method: "GET",
            url: "/api/vehicles/1177/monthly?ym=2026-05",
            status: 500,
            durationMs: 240,
            requestId: "req-1",
            cfRay: "8f-nrt",
            responseExcerpt: '{"driverName":"山田太郎"}',
            at: "10:00",
            ok: false,
          },
        ],
      }),
    });
    const { body } = buildIssueDraft(item, { appOrigin: ORIGIN, shotUrl: null });

    expect(body).toContain("/api/vehicles/:id/monthly");
    expect(body).not.toContain("1177");
    expect(body).not.toContain("山田太郎");
    // 突き合わせの印は残す（これが無いとサーバ側のログを引けない）。
    expect(body).toContain("req-1");
    expect(body).toContain("8f-nrt");
  });

  it("console 出力は件数だけ。中身は Issue に貼らない", () => {
    const item = detail({
      diagnostics: diagnostics({
        console: [
          { level: "error", message: "運賃 1,240,000 円の計算に失敗", stack: null, at: "10:00" },
          { level: "warn", message: "再取得します", stack: null, at: "10:00" },
        ],
      }),
    });
    const { body } = buildIssueDraft(item, { appOrigin: ORIGIN, shotUrl: null });

    expect(body).toContain("console 出力: error 1件 / warn 1件");
    expect(body).not.toContain("1,240,000");
  });

  it("環境はブラウザ・OS・画面の大きさだけ（UserAgent は出さない）", () => {
    const { body } = buildIssueDraft(detail(), { appOrigin: ORIGIN, shotUrl: null });

    expect(body).toContain("Chrome 141");
    expect(body).toContain("1440×900");
    expect(body).not.toContain("Mozilla/5.0");
  });

  it("診断情報が無い要望でも文面が作れる", () => {
    const { body, labels } = buildIssueDraft(
      detail({ diagnostics: null, hasShot: false }),
      { appOrigin: ORIGIN, shotUrl: null },
    );
    expect(body).toContain("取得不可");
    expect(body).toContain("診断情報が付いていません");
    expect(body).toContain("app/(app)/vehicle/[vehicleNo]/page.tsx");
    expect(labels).toEqual(["改善要望", "使いやすさ"]);
  });

  it("原文に混ざった値も、外へ出る一歩手前で伏せる", () => {
    const item = detail({
      body: "ログインできません。password=harunoumi2026 で試しました。連絡先は taro@example.com です。",
    });
    const { body, title } = buildIssueDraft(item, { appOrigin: ORIGIN, shotUrl: null });

    expect(body).not.toContain("harunoumi2026");
    expect(body).not.toContain("taro@example.com");
    expect(title).not.toContain("harunoumi2026");
    // 何を言っているかは残す（伏せた結果、意味まで消してはいけない）。
    expect(body).toContain("ログインできません。");
  });

  it("普通の文章は伏せない（「パスワード」という言葉自体は残る）", () => {
    const item = detail({ body: "パスワードの入力欄が狭くて打ちにくいです。" });
    const { body } = buildIssueDraft(item, { appOrigin: ORIGIN, shotUrl: null });
    expect(body).toContain("パスワードの入力欄が狭くて打ちにくいです。");
  });

  it("通信は一切しない（純粋な組み立てなので、起票せずに中身を確かめられる）", () => {
    const before = JSON.stringify(detail());
    buildIssueDraft(detail(), { appOrigin: ORIGIN, shotUrl: null });
    expect(JSON.stringify(detail())).toBe(before);
  });
});
