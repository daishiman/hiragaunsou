import {
  DIAGNOSTICS_LIMITS,
  DIAGNOSTICS_VERSION,
  SLOW_API_MS,
  type Breadcrumb,
  type ClientDiagnostics,
  type ConsoleEntry,
  type ErrorEntry,
  type NetworkEntry,
} from "../../../src/domain/rules/diagnostics";
import {
  DIAGNOSTICS_UNAVAILABLE,
  elementIdentity,
  maskSensitive,
  maskUrl,
} from "../../../src/domain/rules/diagnosticsMasking";

/**
 * ブラウザの裏で「開発者ツールで見るような情報」を控えておく仕組み。
 *
 * 改善要望を送る人に環境を聞かない代わりに、ここが常に控えている。
 * 送る瞬間に集め始めたのでは遅い ―― エラーは押す前に起きているので、
 * アプリを開いた時点から控え始めて、送るときに直近だけを切り出す。
 *
 * 守っていること。
 *  1. アプリの動きを変えない。console も fetch も、元の動作をそのまま通す
 *  2. 控えるのは直近だけ。件数の上限を超えたら古いものから捨てる
 *  3. 値は控えない。押した要素の見分けが付くところまでで止める
 *  4. 例外を外へ出さない。控える側で失敗しても、業務の操作を止めない
 */

/** 古いものから捨てる控え帳。 */
class Ring<T> {
  private items: T[] = [];
  constructor(private readonly max: number) {}
  push(item: T) {
    this.items.push(item);
    if (this.items.length > this.max) this.items.shift();
  }
  all(): T[] {
    return [...this.items];
  }
  clear() {
    this.items = [];
  }
}

const consoleRing = new Ring<ConsoleEntry>(DIAGNOSTICS_LIMITS.console);
const errorRing = new Ring<ErrorEntry>(DIAGNOSTICS_LIMITS.errors);
const networkRing = new Ring<NetworkEntry>(DIAGNOSTICS_LIMITS.network);
/** うまくいった通信のうち、SLOW_API_MS を超えたものだけ。 */
const slowApiRing = new Ring<NetworkEntry>(DIAGNOSTICS_LIMITS.slowApi);
const crumbRing = new Ring<Breadcrumb>(DIAGNOSTICS_LIMITS.breadcrumbs);

/**
 * 所要時間だけの控え。件数と合計だけを持ち、URL も本文も持たない。
 *
 * 「速さの様子」を出すのに通信の記録そのものは要らない。
 * 記録を残さずに数だけ数えれば、持ち出す情報を増やさずに中央値が出せる。
 */
const durations: number[] = [];
const DURATIONS_MAX = 200;

const notes: string[] = [];

let installed = false;

function now(): string {
  return new Date().toISOString();
}

function note(text: string) {
  if (!notes.includes(text)) notes.push(text);
}

/** 何を渡されても文字列にする。console.error(obj) も控えられるようにする。 */
function stringifyArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/* ───── console ───── */

function installConsole() {
  // error と warn だけ差し替える。info / log は量が桁違いに多く、
  // 30件の枠を埋めてしまって肝心のエラーを押し出す。
  const levels = ["error", "warn"] as const;
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        const fromError = args.find((a): a is Error => a instanceof Error);
        consoleRing.push({
          level,
          message: maskSensitive(args.map(stringifyArg).join(" "), 500),
          stack: fromError?.stack ? maskSensitive(fromError.stack, 1500) : null,
          at: now(),
        });
      } catch {
        // 控えられなくても、元の出力は必ず行う
      }
      original(...args);
    };
  }
}

/* ───── 捕まえ損ねた例外 ───── */

function installErrorHooks() {
  window.addEventListener("error", (event) => {
    try {
      errorRing.push({
        kind: "uncaught",
        message: maskSensitive(event.message || stringifyArg(event.error), 500),
        stack: event.error instanceof Error && event.error.stack
          ? maskSensitive(event.error.stack, 2000)
          : null,
        source: event.filename ? `${maskUrl(event.filename)}:${event.lineno}:${event.colno}` : null,
        at: now(),
      });
    } catch {
      /* 控えられなくても止めない */
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason as unknown;
      errorRing.push({
        kind: "unhandledrejection",
        message: maskSensitive(stringifyArg(reason), 500),
        stack:
          reason instanceof Error && reason.stack ? maskSensitive(reason.stack, 2000) : null,
        source: null,
        at: now(),
      });
    } catch {
      /* 同上 */
    }
  });
}

/* ───── 通信 ───── */

/** サーバ側のログと突き合わせるための印。1回の通信に1つ付ける。 */
function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rid-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }
}

function installFetchHook() {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = performance.now();
    const requestId = newRequestId();
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    // 自分のアプリ宛てのときだけ印を付ける。外部サイトへ独自ヘッダを足すと
    // CORS の事前確認が増え、アプリの動きを変えてしまう。
    let nextInit = init;
    const sameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
    if (sameOrigin) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set("x-request-id", requestId);
      nextInit = { ...init, headers };
    }

    try {
      const response = await original(input, nextInit);
      const durationMs = performance.now() - started;
      void record(response, { method, url, requestId, durationMs, sameOrigin });
      return response;
    } catch (e) {
      networkRing.push({
        method,
        url: maskUrl(url),
        status: null,
        durationMs: Math.round(performance.now() - started),
        requestId,
        cfRay: null,
        responseExcerpt: maskSensitive(stringifyArg(e), 200),
        at: now(),
        ok: false,
      });
      throw e;
    }
  };
}

async function record(
  response: Response,
  meta: { method: string; url: string; requestId: string; durationMs: number; sameOrigin: boolean },
) {
  try {
    const entry: NetworkEntry = {
      method: meta.method,
      url: maskUrl(meta.url),
      status: response.status,
      durationMs: Math.round(meta.durationMs),
      requestId: meta.requestId,
      // Cloudflare が付ける通し番号。Workers のログを引くときの鍵になる。
      cfRay: response.headers.get("cf-ray"),
      responseExcerpt: null,
      at: now(),
      ok: response.ok,
    };

    if (meta.sameOrigin) {
      durations.push(entry.durationMs);
      if (durations.length > DURATIONS_MAX) durations.shift();
    }

    if (!response.ok) {
      // 失敗したときだけ中身を覗く。複製して読むので、呼び出し元の処理は変わらない。
      try {
        const text = await response.clone().text();
        entry.responseExcerpt = maskSensitive(text, 400);
      } catch {
        entry.responseExcerpt = DIAGNOSTICS_UNAVAILABLE;
      }
      networkRing.push(entry);
      return;
    }

    // うまくいった通信は残さない。ただし異常に遅いものは、それ自体が要望の中身
    // (「この画面が遅い」) であることが多いので、そこだけ残す。
    if (meta.sameOrigin && entry.durationMs >= SLOW_API_MS) slowApiRing.push(entry);
  } catch {
    note("通信の記録に失敗したものがあります。");
  }
}

/* ───── 足あと ───── */

function installBreadcrumbs() {
  document.addEventListener(
    "click",
    (event) => {
      try {
        const target = event.target;
        if (!(target instanceof Element)) return;
        // 押されたのが中の文字でも、操作したのはボタン。押した本人の意図に近い方を残す。
        const actionable = target.closest("button, a, [role='button'], summary, label") ?? target;
        crumbRing.push({ kind: "click", target: elementIdentity(actionable), at: now() });
      } catch {
        /* 控えられなくても止めない */
      }
    },
    { capture: true },
  );

  document.addEventListener(
    "submit",
    (event) => {
      try {
        const target = event.target;
        if (target instanceof Element) {
          crumbRing.push({ kind: "submit", target: elementIdentity(target), at: now() });
        }
      } catch {
        /* 同上 */
      }
    },
    { capture: true },
  );

  const pushNavigate = () => {
    try {
      crumbRing.push({
        kind: "navigate",
        target: maskUrl(window.location.pathname + window.location.search),
        at: now(),
      });
    } catch {
      /* 同上 */
    }
  };

  for (const name of ["pushState", "replaceState"] as const) {
    const original = history[name].bind(history);
    history[name] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      pushNavigate();
    };
  }
  window.addEventListener("popstate", pushNavigate);
  pushNavigate();
}

/* ───── 環境 ───── */

/** UserAgent から、人が読める形の名前を取り出す。細かい判別より外さないことを優先する。 */
export function browserOf(ua: string): string {
  const table: [RegExp, string][] = [
    [/Edg\/([\d.]+)/, "Microsoft Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/CriOS\/([\d.]+)/, "Chrome (iOS)"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
  ];
  for (const [re, name] of table) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1] ?? ""}`.trim();
  }
  return DIAGNOSTICS_UNAVAILABLE;
}

export function osOf(ua: string): string {
  const table: [RegExp, (m: RegExpExecArray) => string][] = [
    [/Windows NT ([\d.]+)/, (m) => `Windows ${m[1] === "10.0" ? "10/11" : m[1]}`],
    [/Mac OS X ([\d_.]+)/, (m) => `macOS ${(m[1] ?? "").replace(/_/g, ".")}`],
    [/iPhone OS ([\d_]+)/, (m) => `iOS ${(m[1] ?? "").replace(/_/g, ".")}`],
    [/iPad.*OS ([\d_]+)/, (m) => `iPadOS ${(m[1] ?? "").replace(/_/g, ".")}`],
    [/Android ([\d.]+)/, (m) => `Android ${m[1]}`],
    [/Linux/, () => "Linux"],
  ];
  for (const [re, format] of table) {
    const m = re.exec(ua);
    if (m) return format(m);
  }
  return DIAGNOSTICS_UNAVAILABLE;
}

function environmentOf() {
  const ua = navigator.userAgent ?? "";
  return {
    userAgent: maskSensitive(ua, 300),
    browser: browserOf(ua),
    os: osOf(ua),
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio ?? DIAGNOSTICS_UNAVAILABLE,
    touch: typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints > 0 : DIAGNOSTICS_UNAVAILABLE,
    language: navigator.language ?? DIAGNOSTICS_UNAVAILABLE,
    timezone: timezoneOf(),
    online: typeof navigator.onLine === "boolean" ? navigator.onLine : DIAGNOSTICS_UNAVAILABLE,
  };
}

function timezoneOf(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DIAGNOSTICS_UNAVAILABLE;
  } catch {
    return DIAGNOSTICS_UNAVAILABLE;
  }
}

function performanceOf() {
  // 中央値は全ての通信から出す (遅かったものだけで数えると、必ず遅い値になる)。
  const sorted = [...durations].sort((a, b) => a - b);
  const slowest = slowApiRing.all().reduce<NetworkEntry | null>(
    (max, e) => (max === null || e.durationMs > max.durationMs ? e : max),
    null,
  );
  return {
    pageLoadMs: pageLoadMs(),
    slowestApi: slowest ? { url: slowest.url, durationMs: slowest.durationMs } : null,
    medianApiMs:
      sorted.length > 0
        ? Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0)
        : DIAGNOSTICS_UNAVAILABLE,
  };
}

function pageLoadMs(): number | string {
  try {
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (!nav || !nav.loadEventEnd) return DIAGNOSTICS_UNAVAILABLE;
    return Math.round(nav.loadEventEnd - nav.startTime);
  } catch {
    return DIAGNOSTICS_UNAVAILABLE;
  }
}

/* ───── 出入口 ───── */

/**
 * 控え始める。二重に呼ばれても1回しか仕掛けない
 * (React の開発モードでは初期化が2回走るため)。
 */
export function installDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  try {
    installConsole();
    installErrorHooks();
    installFetchHook();
    installBreadcrumbs();
  } catch {
    note("診断情報の記録を仕掛けられませんでした。");
  }
}

/** いま控えている分を切り出す。改善要望を送る直前に呼ぶ。 */
export function collectDiagnostics(): ClientDiagnostics {
  return {
    version: DIAGNOSTICS_VERSION,
    referrer: document.referrer ? maskUrl(document.referrer) : "（直接開いた）",
    build: {
      id: process.env.NEXT_PUBLIC_APP_BUILD || DIAGNOSTICS_UNAVAILABLE,
      commit: process.env.NEXT_PUBLIC_APP_COMMIT || DIAGNOSTICS_UNAVAILABLE,
    },
    environment: environmentOf(),
    performance: performanceOf(),
    console: consoleRing.all(),
    errors: errorRing.all(),
    network: networkRing.all(),
    slowApi: slowApiRing.all(),
    breadcrumbs: crumbRing.all(),
    notes: [...notes, ...(installed ? [] : ["診断情報の記録が動いていません。"])],
  };
}

/**
 * テスト用。控え帳だけを空にする。
 *
 * 仕掛けた側 (console や fetch の差し替え) は外さない。外して仕掛け直すと
 * 差し替えが二重になり、1回の出力が2件に見えてしまう。
 */
export function resetDiagnosticsForTest() {
  consoleRing.clear();
  errorRing.clear();
  networkRing.clear();
  slowApiRing.clear();
  crumbRing.clear();
  durations.length = 0;
  notes.length = 0;
}
