import { DIAGNOSTICS_UNAVAILABLE, maskSensitive, maskUrl } from "./diagnosticsMasking";

/**
 * 改善要望に自動で付く診断情報の形と、その量の決まり。
 *
 * 目的は1つ。「この画面が変です」という一文だけで届いた要望を、
 * 送った人に聞き直さずに再現できる状態にすること。
 * 送る側に環境を書かせない代わりに、ブラウザが知っていることを裏で集める。
 *
 * 集める量に上限を置くのは、D1 に本文・画像と同じ1件として入るため。
 * 上限を超えたら「古いものから捨てる」。新しい方を捨てると、
 * 押した直後に出たエラー (一番知りたいもの) が真っ先に消える。
 *
 * 集めないと決めたもの (実装しない)。
 *  - Cookie / localStorage / sessionStorage の中身
 *  - リクエスト・レスポンスの本文まるごと (業務データそのもの)
 *  - うまくいった通信の全件 (遅かったものだけ残す)
 *  - DOM 全体のスナップショット、セッション録画
 * どれも「あれば便利」だが、無くても再現はできる。持てば漏れる側の risk だけが残る。
 */

export const DIAGNOSTICS_VERSION = 1;

/** 診断情報1件の上限。画像 (700KB) と合わせても送信全体 (960KB) に収まる大きさ。 */
export const DIAGNOSTICS_MAX_BYTES = 60_000;

/** 種類ごとの件数上限。捨てるときは古いものから。 */
export const DIAGNOSTICS_LIMITS = {
  console: 30,
  errors: 10,
  network: 15,
  slowApi: 10,
  breadcrumbs: 30,
} as const;

/**
 * 「異常に遅い」と見なす境目 (ミリ秒)。
 *
 * うまくいった通信は原則として残さない。残すのはここを超えたものだけ。
 * 全件残すと、量の大半が「正常でした」の記録で埋まり、肝心の失敗が押し出される。
 */
export const SLOW_API_MS = 3_000;

export interface ConsoleEntry {
  /** error と warn だけ。info / log / debug は量ばかり増えて手がかりにならないので集めない。 */
  level: "error" | "warn";
  message: string;
  stack: string | null;
  at: string;
}

export interface ErrorEntry {
  /** uncaught = 捕まえ損ねた例外、unhandledrejection = 後始末されなかった非同期処理 */
  kind: "uncaught" | "unhandledrejection";
  message: string;
  stack: string | null;
  source: string | null;
  at: string;
}

export interface NetworkEntry {
  method: string;
  url: string;
  /** 通信自体が成立しなかったときは null。 */
  status: number | null;
  durationMs: number;
  /** サーバ側ログと突き合わせるための印。 */
  requestId: string | null;
  cfRay: string | null;
  /** 失敗したときだけ入る、返ってきた中身の冒頭 (マスク済み)。 */
  responseExcerpt: string | null;
  at: string;
  ok: boolean;
}

export interface Breadcrumb {
  kind: "click" | "navigate" | "submit" | "input";
  /** 要素の見分けが付くところまで。入力された値は入れない。 */
  target: string;
  at: string;
}

export interface DiagnosticsEnvironment {
  userAgent: string;
  browser: string;
  os: string;
  viewport: string;
  devicePixelRatio: number | string;
  touch: boolean | string;
  language: string;
  timezone: string;
  online: boolean | string;
}

export interface DiagnosticsPerformance {
  /** 画面を開いてから読み終わるまで (ミリ秒)。 */
  pageLoadMs: number | string;
  /** この画面で呼んだAPIの中で一番遅かったもの。 */
  slowestApi: { url: string; durationMs: number } | null;
  /** APIの所要時間の中央値。 */
  medianApiMs: number | string;
}

/** ブラウザ側で集めた分。誰が送ったか・どの画面かはサーバ側で入れ直す。 */
export interface ClientDiagnostics {
  version: number;
  referrer: string;
  build: { id: string; commit: string };
  environment: DiagnosticsEnvironment;
  performance: DiagnosticsPerformance;
  console: ConsoleEntry[];
  errors: ErrorEntry[];
  /** 失敗した通信だけ (4xx / 5xx / 到達しなかったもの)。 */
  network: NetworkEntry[];
  /** うまくいった通信のうち、SLOW_API_MS を超えたものだけ。 */
  slowApi: NetworkEntry[];
  breadcrumbs: Breadcrumb[];
  /** 集めきれなかった・捨てたものがあれば理由を書く。 */
  notes: string[];
}

/** 保存する最終形。サーバ側でしか分からないものを足したもの。 */
export interface StoredDiagnostics extends ClientDiagnostics {
  occurredAt: { utc: string; jst: string };
  screen: { path: string; routePattern: string; label: string; sourceFile: string };
  /**
   * 送った人。氏名・メールは管理画面の中でだけ見せる (Issue には出さない)。
   * 会社は1社専用なので id を固定値で持ち、会社名は保存しない。
   */
  reporter: { id: string; name: string; role: string; companyId: string };
}

/**
 * ブラウザから届いた診断情報を、保存してよい形に整える。
 *
 * ブラウザから来る値は信用しない。形が違えば「取得不可」に倒し、
 * 文字列は全てマスクを通し、件数と全体の大きさで切り詰める。
 * 例外を投げないのは、診断情報の不備で要望そのものが届かなくなる方が損だから。
 */
export function sanitizeClientDiagnostics(raw: unknown): ClientDiagnostics {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const notes = asStringArray(src.notes).slice(0, 5);

  const result: ClientDiagnostics = {
    version: DIAGNOSTICS_VERSION,
    referrer: maskUrl(asString(src.referrer, DIAGNOSTICS_UNAVAILABLE)),
    build: {
      id: asString(asRecord(src.build).id, DIAGNOSTICS_UNAVAILABLE).slice(0, 100),
      commit: asString(asRecord(src.build).commit, DIAGNOSTICS_UNAVAILABLE).slice(0, 60),
    },
    environment: sanitizeEnvironment(asRecord(src.environment)),
    performance: sanitizePerformance(asRecord(src.performance)),
    // level は先に絞る。後で捨てると、info で埋まった30件から2件しか残らないことがある。
    console: asArray(src.console)
      .filter((e) => e.level === "error" || e.level === "warn")
      .slice(-DIAGNOSTICS_LIMITS.console)
      .map(sanitizeConsole),
    errors: asArray(src.errors).slice(-DIAGNOSTICS_LIMITS.errors).map(sanitizeError),
    network: asArray(src.network).slice(-DIAGNOSTICS_LIMITS.network).map(sanitizeNetwork),
    // 遅かったものだけを残す。成功した通信をブラウザ側が送ってきても、ここで落とす。
    slowApi: asArray(src.slowApi)
      .filter((e) => typeof e.durationMs === "number" && e.durationMs >= SLOW_API_MS)
      .slice(-DIAGNOSTICS_LIMITS.slowApi)
      .map(sanitizeNetwork),
    breadcrumbs: asArray(src.breadcrumbs).slice(-DIAGNOSTICS_LIMITS.breadcrumbs).map(sanitizeCrumb),
    notes,
  };

  return trimToBudget(result);
}

/**
 * 上限に収まるまで、古いものから捨てる。
 *
 * 捨てる順は「無くても再現できるもの」から。足あと → 成功したAPI →
 * 失敗した通信 → console の順で、未捕捉の例外は最後まで残す
 * (例外だけは、それ自体が答えであることが多い)。
 */
function trimToBudget(input: ClientDiagnostics): ClientDiagnostics {
  const result = { ...input };
  const shrinkers: { name: string; take: () => boolean }[] = [
    { name: "足あと", take: () => shift(result.breadcrumbs) },
    { name: "遅かった通信", take: () => shift(result.slowApi) },
    { name: "失敗した通信", take: () => shift(result.network) },
    { name: "console出力", take: () => shift(result.console) },
    { name: "例外", take: () => shift(result.errors) },
  ];

  const dropped = new Set<string>();
  for (const shrinker of shrinkers) {
    while (byteLengthOf(result) > DIAGNOSTICS_MAX_BYTES && shrinker.take()) {
      dropped.add(shrinker.name);
    }
    if (byteLengthOf(result) <= DIAGNOSTICS_MAX_BYTES) break;
  }

  if (dropped.size > 0) {
    result.notes = [
      ...result.notes,
      `大きすぎたため、古い順に捨てました（${[...dropped].join("・")}）。`,
    ];
  }
  return result;
}

function shift(list: unknown[]): boolean {
  if (list.length === 0) return false;
  list.shift();
  return true;
}

export function byteLengthOf(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/* ───── ここから下は「壊れた値でも落ちない」ための変換 ───── */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").map((v) => maskSensitive(v, 200))
    : [];
}

function asNumber(value: unknown, fallback: string): number | string {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: string): boolean | string {
  return typeof value === "boolean" ? value : fallback;
}

function asTime(value: unknown): string {
  return typeof value === "string" && value.length <= 40 ? value : DIAGNOSTICS_UNAVAILABLE;
}

function sanitizeEnvironment(src: Record<string, unknown>): DiagnosticsEnvironment {
  return {
    userAgent: maskSensitive(asString(src.userAgent, DIAGNOSTICS_UNAVAILABLE), 300),
    browser: maskSensitive(asString(src.browser, DIAGNOSTICS_UNAVAILABLE), 80),
    os: maskSensitive(asString(src.os, DIAGNOSTICS_UNAVAILABLE), 80),
    viewport: maskSensitive(asString(src.viewport, DIAGNOSTICS_UNAVAILABLE), 40),
    devicePixelRatio: asNumber(src.devicePixelRatio, DIAGNOSTICS_UNAVAILABLE),
    touch: asBoolean(src.touch, DIAGNOSTICS_UNAVAILABLE),
    language: maskSensitive(asString(src.language, DIAGNOSTICS_UNAVAILABLE), 20),
    timezone: maskSensitive(asString(src.timezone, DIAGNOSTICS_UNAVAILABLE), 60),
    online: asBoolean(src.online, DIAGNOSTICS_UNAVAILABLE),
  };
}

function sanitizePerformance(src: Record<string, unknown>): DiagnosticsPerformance {
  const slowest = asRecord(src.slowestApi);
  const url = typeof slowest.url === "string" ? maskUrl(slowest.url) : null;
  const durationMs = typeof slowest.durationMs === "number" ? Math.round(slowest.durationMs) : null;
  return {
    pageLoadMs: asNumber(src.pageLoadMs, DIAGNOSTICS_UNAVAILABLE),
    slowestApi: url !== null && durationMs !== null ? { url, durationMs } : null,
    medianApiMs: asNumber(src.medianApiMs, DIAGNOSTICS_UNAVAILABLE),
  };
}

function sanitizeConsole(src: Record<string, unknown>): ConsoleEntry {
  return {
    level: src.level === "warn" ? "warn" : "error",
    message: maskSensitive(asString(src.message, ""), 500),
    stack: typeof src.stack === "string" ? maskSensitive(src.stack, 1500) : null,
    at: asTime(src.at),
  };
}

function sanitizeError(src: Record<string, unknown>): ErrorEntry {
  return {
    kind: src.kind === "unhandledrejection" ? "unhandledrejection" : "uncaught",
    message: maskSensitive(asString(src.message, ""), 500),
    stack: typeof src.stack === "string" ? maskSensitive(src.stack, 2000) : null,
    source: typeof src.source === "string" ? maskUrl(src.source) : null,
    at: asTime(src.at),
  };
}

function sanitizeNetwork(src: Record<string, unknown>): NetworkEntry {
  return {
    method: maskSensitive(asString(src.method, "GET"), 10).toUpperCase(),
    url: maskUrl(asString(src.url, DIAGNOSTICS_UNAVAILABLE)),
    status: typeof src.status === "number" ? src.status : null,
    durationMs: typeof src.durationMs === "number" ? Math.round(src.durationMs) : 0,
    requestId: typeof src.requestId === "string" ? maskSensitive(src.requestId, 80) : null,
    cfRay: typeof src.cfRay === "string" ? maskSensitive(src.cfRay, 40) : null,
    responseExcerpt:
      typeof src.responseExcerpt === "string" ? maskSensitive(src.responseExcerpt, 400) : null,
    at: asTime(src.at),
    ok: src.ok === true,
  };
}

function sanitizeCrumb(src: Record<string, unknown>): Breadcrumb {
  const kind = src.kind;
  return {
    kind:
      kind === "navigate" || kind === "submit" || kind === "input"
        ? kind
        : "click",
    target: maskSensitive(asString(src.target, DIAGNOSTICS_UNAVAILABLE), 150),
    at: asTime(src.at),
  };
}

/** 発生時刻を UTC と JST の両方で持つ。時差の読み替えを人にさせない。 */
export function occurredAtOf(date: Date): { utc: string; jst: string } {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    utc: date.toISOString(),
    jst:
      `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ` +
      `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())} JST`,
  };
}

/**
 * route pattern から、直せばよいファイルを引く。
 *
 * Next.js の app ルーターでは URL とフォルダが1対1なので、対応表を別に持たない
 * (別に持つと、画面を足したときに必ず片方だけ古くなる)。
 */
export function sourceFileOf(routePattern: string): string {
  if (routePattern === "/") return "app/(app)/page.tsx";
  if (!routePattern.startsWith("/")) return DIAGNOSTICS_UNAVAILABLE;
  return `app/(app)${routePattern}/page.tsx`;
}
