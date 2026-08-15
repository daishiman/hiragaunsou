/** @vitest-environment jsdom */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserOf,
  collectDiagnostics,
  installDiagnostics,
  osOf,
  resetDiagnosticsForTest,
} from "../../app/_lib/diagnostics/recorder";

/**
 * ブラウザ側の控え帳。
 *
 * 確かめたいのは「アプリの動きを変えずに、後から再現できるだけの記録が残るか」。
 * 特に、控える側の都合で業務の操作が止まらないこと (例外を外へ出さないこと) を見る。
 */
describe("診断情報の記録", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  /**
   * 仕掛けは「仕掛けた時点の fetch」を内側に抱え込む。後から差し替えても届かないので、
   * 仕掛ける前に差し替え口を1つ置いて、テストごとに中身だけを入れ替える。
   */
  let innerFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  let sentHeaders: Headers | null = null;

  beforeAll(() => {
    innerFetch = async () => new Response("{}", { status: 200 });
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      innerFetch(input, init)) as typeof window.fetch;
    // 先に出力を黙らせてから仕掛ける。順番が逆だと、後から差し替えた側が
    // 控える処理ごと置き換わり、何も控えられていないのに通ってしまう。
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installDiagnostics();
  });

  beforeEach(() => {
    // 仕掛けはページに1回だけ。控え帳の中身だけを各テストで空にする。
    resetDiagnosticsForTest();
    errorSpy.mockClear();
    sentHeaders = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("console.error を控えつつ、元の出力もそのまま行う", () => {
    console.error("計算に失敗しました");
    expect(errorSpy).toHaveBeenCalledWith("計算に失敗しました");
    expect(collectDiagnostics().console.at(-1)?.message).toContain("計算に失敗しました");
  });

  it("console に混ざった秘密は控える前に伏せる", () => {
    console.warn("再ログイン password=harunoumi2026");
    const dump = JSON.stringify(collectDiagnostics().console);
    expect(dump).not.toContain("harunoumi2026");
    // 控えたこと自体は分かる（丸ごと捨てない）。
    expect(dump).toContain("再ログイン");
  });

  it("console.log は控えない（量ばかり増えて手がかりにならない）", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    console.log("ふつうの記録");
    spy.mockRestore();
    expect(JSON.stringify(collectDiagnostics().console)).not.toContain("ふつうの記録");
  });

  it("console.info も控えない（error と warn だけ残す）", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    console.info("読み込みました");
    spy.mockRestore();
    expect(JSON.stringify(collectDiagnostics().console)).not.toContain("読み込みました");
  });

  it("捕まえ損ねた例外を、発生場所つきで控える", () => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Cannot read properties of null",
        filename: "https://app.example.com/_next/x.js?token=abcdef123456",
        lineno: 12,
        colno: 3,
        error: new Error("Cannot read properties of null"),
      }),
    );
    const e = collectDiagnostics().errors.at(-1);
    expect(e?.kind).toBe("uncaught");
    expect(e?.message).toContain("Cannot read properties of null");
    expect(e?.source).toContain(":12:3");
    // URLに混ざった値は伏せる。
    expect(e?.source).not.toContain("abcdef123456");
  });

  it("押した要素は見分けが付くところまで控え、入力された値は控えない", () => {
    document.body.innerHTML = `
      <button id="save" aria-label="保存">保存<span id="inner">する</span></button>
      <input id="vehicle_no" value="1177" />
    `;
    document.getElementById("inner")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const crumb = collectDiagnostics().breadcrumbs.at(-1);
    // 押されたのが中の文字でも、操作したのはボタン。
    expect(crumb?.target).toContain("button#save");
    expect(crumb?.target).toContain("保存");
    expect(JSON.stringify(collectDiagnostics().breadcrumbs)).not.toContain("1177");
  });

  it("画面の移動を足あとに残す", () => {
    history.pushState({}, "", "/vehicle/1177?ym=2026-05");
    const crumb = collectDiagnostics().breadcrumbs.at(-1);
    expect(crumb?.kind).toBe("navigate");
    expect(crumb?.target).toContain("/vehicle/1177");
    // クエリの値は伏せる (何を見ていたかの手がかりは名前だけ残す)。
    expect(crumb?.target).toContain("ym=");
    expect(crumb?.target).not.toContain("2026-05");
  });

  it("失敗した通信を、突き合わせ用の印つきで控える", async () => {
    innerFetch = async (_input, init) => {
      // 自分のアプリ宛てなので、突き合わせ用の印が足されているはず。
      sentHeaders = new Headers(init?.headers);
      return new Response("権限がありません", {
        status: 403,
        headers: { "cf-ray": "9a1b2c3d4e5f-NRT" },
      });
    };
    await window.fetch("/api/vehicles?ym=2026-05", { method: "POST" });

    expect(sentHeaders?.get("x-request-id")).toBeTruthy();
    // 控えるのは応答を返した後。呼び出し元を待たせないための作りなので、
    // ここでも1呼吸おいてから確かめる。
    await new Promise((resolve) => setTimeout(resolve, 0));

    const d = collectDiagnostics();
    const entry = d.network.at(-1);
    expect(entry?.status).toBe(403);
    expect(entry?.method).toBe("POST");
    // サーバ側のログと突き合わせるための印。
    expect(entry?.cfRay).toBe("9a1b2c3d4e5f-NRT");
    expect(entry?.requestId).toBeTruthy();
    expect(entry?.responseExcerpt).toContain("権限がありません");
    // クエリの値は伏せ、どのAPIかは残す。
    expect(entry?.url).toContain("/api/vehicles");
    expect(entry?.url).not.toContain("2026-05");
  });

  it("うまくいった通信は残さない（速いものは記録そのものを作らない）", async () => {
    innerFetch = async () => new Response("ok", { status: 200 });
    await window.fetch("/api/vehicles?ym=2026-05");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const d = collectDiagnostics();
    expect(d.network).toHaveLength(0);
    expect(d.slowApi).toHaveLength(0);
    // 記録は残さないが、速さの様子は数として分かる。
    expect(typeof d.performance.medianApiMs).toBe("number");
  });

  it("3秒を超えた通信だけは、うまくいっていても残す", async () => {
    // 「この画面が遅い」という要望のとき、遅かったこと自体が答えになる。
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => (clock += 3_500));
    innerFetch = async () => new Response("ok", { status: 200 });
    await window.fetch("/api/vehicles/1177/monthly");
    await new Promise((resolve) => setTimeout(resolve, 0));
    nowSpy.mockRestore();

    const d = collectDiagnostics();
    expect(d.slowApi.at(-1)?.url).toContain("/api/vehicles");
    expect(d.slowApi.at(-1)?.durationMs).toBeGreaterThanOrEqual(3_000);
    expect(d.performance.slowestApi?.durationMs).toBeGreaterThanOrEqual(3_000);
  });

  it("環境を取り、取れないものは取得不可と書く", () => {
    const d = collectDiagnostics();
    expect(d.environment.viewport).toMatch(/^\d+×\d+$/);
    expect(typeof d.environment.language).toBe("string");
    expect(d.version).toBe(1);
    // jsdom では読み込み時間が取れない。空欄にせず、取れないことを書く。
    expect(d.performance.pageLoadMs).toBeDefined();
  });

  it("仕掛けを二重に呼んでも、控えは二重にならない", () => {
    installDiagnostics();
    installDiagnostics();
    console.error("1回だけ");
    const hits = collectDiagnostics().console.filter((c) => c.message.includes("1回だけ"));
    expect(hits).toHaveLength(1);
  });
});

describe("browserOf / osOf", () => {
  it("よく使うブラウザを名前と版で言い当てる", () => {
    expect(browserOf("Mozilla/5.0 ... Chrome/141.0.0.0 Safari/537.36")).toBe("Chrome 141.0.0.0");
    expect(browserOf("Mozilla/5.0 ... Chrome/141 Safari/537.36 Edg/141.0.1")).toBe(
      "Microsoft Edge 141.0.1",
    );
    expect(browserOf("Mozilla/5.0 ... Version/17.0 Safari/605.1.15")).toBe("Safari 17.0");
    expect(browserOf("Mozilla/5.0 ... Firefox/130.0")).toBe("Firefox 130.0");
  });

  it("読み取れないものは取得不可にする（勝手に決めつけない）", () => {
    expect(browserOf("なにかの端末")).toBe("取得不可");
    expect(osOf("なにかの端末")).toBe("取得不可");
  });

  it("OS を人が読める形で返す", () => {
    expect(osOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows 10/11");
    expect(osOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS 10.15.7");
    expect(osOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("iOS 17.0");
    expect(osOf("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("Android 14");
  });
});
