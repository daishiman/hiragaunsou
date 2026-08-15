import type { ImprovementDetail } from "../repositories/ImprovementRepository";
import {
  sourceFileOf,
  type Breadcrumb,
  type NetworkEntry,
  type StoredDiagnostics,
} from "./diagnostics";
import { DIAGNOSTICS_UNAVAILABLE, maskSensitive } from "./diagnosticsMasking";
import { IMPROVEMENT_BODY_MAX } from "./improvement";

/**
 * 届いた改善要望を、Claude Code がそのまま実行できる「指示文」にする。
 *
 * 満たすべき条件は2つ。
 *   1. これだけ読んで着手できること — 他を見に行かないと分からない情報を残さない
 *   2. 直ったかどうかを、書いた側と読んだ側で同じ基準で判定できること
 *
 * 2つ目のために受け入れ条件を必ず入れる。症状と再現手順だけを渡すと、
 * 「それらしく直った」で終わってしまい、直ったかどうかを誰も判定できない。
 *
 * 通信は一切しない純粋な組み立て。だから発行せずに中身だけ確認でき (dry-run)、
 * テストで文面そのものを固定できる。
 */

/**
 * 指示文に載せないもの。
 *
 * この指示文はコピーして持ち出される前提で作る (それが目的の道具なので)。
 * アプリの外に出ないとはいえ、貼り付け先まではこちらで決められない。だから
 * 値の形をした認証情報・連絡先はここでふるいにかける (maskSensitive)。
 *
 * 逆に、GitHub の公開 Issue に出すときに落としていたもの
 * (失敗した通信の中身・実URL・console の全件) は、外の公開領域へ出さなくなったため
 * 指示文には載せる。直すのに要る情報を、直す人が見に行けないと二度手間になる。
 */
export interface Instruction {
  /** 一覧やコピー用の見出し。 */
  title: string;
  /** Claude Code に渡す本体。 */
  markdown: string;
  /** 将来の自動化のための構造化データ (format=json で返す)。 */
  structured: StructuredInstruction;
}

export interface StructuredInstruction {
  id: string;
  title: string;
  /** 不具合 / 要調査 / 使いやすさ。 */
  kind: InstructionKind;
  /** 高 / 中 / 低。直す順を機械で決められるようにする。 */
  priority: InstructionPriority;
  screenLabel: string;
  routePattern: string;
  sourceFile: string;
  /** 利用者が書いたことそのまま (伏せる処理だけ通す)。 */
  request: string;
  reproduction: string[];
  acceptance: string[];
  environment: { browser: string; os: string; viewport: string } | null;
  errors: { kind: string; message: string; source: string | null; stack: string | null }[];
  failedRequests: {
    method: string;
    endpoint: string;
    status: number | null;
    durationMs: number;
    requestId: string | null;
    responseExcerpt: string | null;
  }[];
  slowRequests: { endpoint: string; durationMs: number }[];
  consoleLog: { level: string; at: string; text: string }[];
  shotUrl: string | null;
  adminUrl: string;
  occurredAt: { jst: string; utc: string };
  build: { id: string | null; commit: string | null };
}

export type InstructionKind = "不具合" | "要調査" | "使いやすさ";
export type InstructionPriority = "高" | "中" | "低";

export interface InstructionOptions {
  /** 管理画面へ戻るためのURLを作る元 (例: https://example.workers.dev)。 */
  appOrigin: string;
  /** 画面の写しを見るための期限付きURL。用意できないときは null。 */
  shotUrl: string | null;
  /** 何版目か。1件の要望に対して指示文は1つで、中身が変わったときだけ上がる。 */
  version: number;
}

function outgoing(text: string): string {
  return maskSensitive(text, IMPROVEMENT_BODY_MAX);
}

/* ───────────────────────── 種類と優先度 ───────────────────────── */

/**
 * 不具合かどうかを、送った人の言葉ではなく診断情報から決める。
 *
 * 「使いにくい」と書かれていても裏で例外が出ているなら不具合であり、直す順番が変わる。
 * 人の申告だけに頼ると、この取り違えが起きる。
 */
export function instructionKindOf(diagnostics: StoredDiagnostics | null): InstructionKind {
  if (!diagnostics) return "使いやすさ";
  const hasException = diagnostics.errors.length > 0;
  const hasServerError = diagnostics.network.some((n) => n.status === null || n.status >= 500);
  const hasClientError = diagnostics.network.some(
    (n) => typeof n.status === "number" && n.status >= 400 && n.status < 500,
  );
  if (hasException || hasServerError) return "不具合";
  if (hasClientError) return "要調査";
  return "使いやすさ";
}

/** 直す順。操作が止まっているものを最優先にする。 */
export function instructionPriorityOf(kind: InstructionKind): InstructionPriority {
  if (kind === "不具合") return "高";
  if (kind === "要調査") return "中";
  return "低";
}

/** 見出しに出す一行。長い本文は切り、改行は潰す。 */
export function instructionTitleOf(item: Pick<ImprovementDetail, "screenLabel" | "body">): string {
  const summary = outgoing(item.body).replace(/\s+/g, " ").trim();
  const cut = summary.length > 50 ? `${summary.slice(0, 50)}…` : summary;
  return `[改善要望] ${item.screenLabel}: ${cut}`;
}

/* ───────────────────────── 受け入れ条件 ───────────────────────── */

/**
 * 何が直れば完了と見なせるか。
 *
 * 症状から機械的に導く。「利用者の指摘が解消していること」だけでは判定できないので、
 * 診断情報に出ている事実 (例外が出た・この通信が失敗した・この操作でこうなった) を
 * そのまま条件に変える。人が後から足せるよう、条件は箇条書きで並べる。
 */
export function acceptanceCriteriaOf(
  item: ImprovementDetail,
  d: StoredDiagnostics | null,
  kind: InstructionKind,
): string[] {
  const criteria: string[] = [];
  const steps = d?.breadcrumbs.length ? "下の再現手順" : `${item.screenLabel} を開く操作`;

  if (kind === "不具合") {
    if (d && d.errors.length > 0) {
      criteria.push(
        `${steps}をたどっても、下に挙げた例外（${d.errors[0]?.message ?? "例外"}）が出ないこと`,
      );
    }
    const failed = d?.network.filter((n) => n.status === null || n.status >= 500) ?? [];
    for (const n of failed.slice(0, 3)) {
      criteria.push(
        `\`${n.method} ${endpointOf(n.url)}\` が ${n.status ?? "通信できない"} を返さず、正常に応答すること`,
      );
    }
  } else if (kind === "要調査") {
    const failed = d?.network.filter((n) => typeof n.status === "number" && n.status < 500) ?? [];
    for (const n of failed.slice(0, 3)) {
      criteria.push(
        `\`${n.method} ${endpointOf(n.url)}\` が ${n.status} を返す原因を特定し、入力が正しいのに失敗する場合は直すこと`,
      );
    }
    criteria.push("原因が利用者の入力にある場合は、何が足りないかを画面に日本語で出すこと");
  } else {
    criteria.push(
      `${item.screenLabel} で、利用者が書いた不便（下の「利用者が書いたこと」）が解消していること`,
    );
    criteria.push(
      "入力の作法（空欄の意味・自動計算値の扱い・Enter の挙動）と、現在地・退避先の固定表示を、他の画面と揃えること",
    );
  }

  // どの種類でも共通。ここを外すと「直したつもり」が通ってしまう。
  criteria.push("直した内容を確かめるテストを追加し、直す前のコードでは落ちることを確認すること");
  criteria.push("`pnpm run typecheck` `pnpm run lint` `pnpm run test` がすべて通ること");
  criteria.push("`pnpm run preview`（http://localhost:8787）で、上の再現手順をたどって直っていること");
  return criteria;
}

/* ───────────────────────── 本体 ───────────────────────── */

export function buildInstruction(
  item: ImprovementDetail,
  options: InstructionOptions,
): Instruction {
  const d = item.diagnostics;
  const adminUrl = `${options.appOrigin.replace(/\/$/, "")}/admin/improvements/${item.id}`;
  const kind = instructionKindOf(d);
  const priority = instructionPriorityOf(kind);
  const sourceFile = d?.screen.sourceFile ?? sourceFileOf(item.routePattern);
  const acceptance = acceptanceCriteriaOf(item, d, kind);
  const reproduction = reproductionSteps(d);
  const title = instructionTitleOf(item);

  const lines: string[] = [
    `# ${title}`,
    "",
    "## この指示について",
    "",
    "これは、実際にこのアプリを使っている人から届いた改善要望です。",
    "下の受け入れ条件を満たすところまで直してください。分からないことがあれば、",
    "推測で仕様を変えず、末尾の管理画面リンクにある元の要望を確認してください。",
    "",
    `| 項目 | 値 |`,
    `| --- | --- |`,
    `| 種類 | ${kind} |`,
    `| 優先度 | ${priority} |`,
    `| 画面 | ${item.screenLabel} |`,
    `| route pattern | \`${item.routePattern}\` |`,
    `| 直す場所（推定） | \`${sourceFile}\` |`,
    `| 指示文の版 | v${options.version} |`,
    "",
    "## 利用者が書いたこと",
    "",
    // 要約しない。要約すると「そう言っていない」ことが独り歩きする。
    quote(outgoing(item.body)),
    "",
    "## 症状",
    "",
    symptomOf(item, d, kind),
    "",
    "## 再現手順",
    "",
    reproduction.length > 0
      ? [
          "送信の直前にたどった操作です（上から順に）。入力した値そのものは記録していません。",
          "",
          ...reproduction.map((s, i) => `${i + 1}. ${s}`),
        ].join("\n")
      : "操作の足あとは記録されていません。画面を開いた直後の状態から確かめてください。",
    "",
    "## 受け入れ条件",
    "",
    ...acceptance.map((c) => `- [ ] ${c}`),
    "",
    "## やらないこと",
    "",
    "- 要望に書かれていない機能を足さない（気づいたことは管理画面の残課題へ回す）",
    "- 既存の画面の作法（配色・入力の決まり・固定表示）を、この1件のために変えない",
    "- 改善要望のデータ（本文・画面の写し・診断情報）を、このリポジトリの中へコピーしない",
    "",
    "## 画面の写し",
    "",
    shotSection(item, options, adminUrl),
    "",
  ];

  if (d) {
    lines.push(
      "## 診断情報",
      "",
      foldable("環境（ブラウザ・OS・画面）", environmentTable(d)),
      "",
      foldable("捕まえ損ねた例外", errorSection(d)),
      "",
      foldable("失敗した通信", networkTable(d.network, "失敗した通信はありません。")),
      "",
      foldable("3秒を超えた通信", networkTable(d.slowApi, "3秒を超えた通信はありません。")),
      "",
      foldable("console の error / warn", consoleSection(d)),
      "",
      foldable("速さ", performanceTable(d)),
      "",
      "### いつ・どの版で",
      "",
      `| 項目 | 値 |`,
      `| --- | --- |`,
      `| 発生時刻 (JST) | ${d.occurredAt.jst} |`,
      `| 発生時刻 (UTC) | ${d.occurredAt.utc} |`,
      `| 送った人の権限 | ${d.reporter.role} |`,
      `| アプリの版 | ${code(d.build.id)} |`,
      `| コミット | ${code(d.build.commit)} |`,
      "",
    );
    if (d.notes.length > 0) {
      lines.push(`> 診断情報についての注記: ${d.notes.join(" / ")}`, "");
    }
  } else {
    lines.push(
      "## 診断情報",
      "",
      "この要望には診断情報が付いていません（この仕組みを入れる前に送られたか、集められなかった要望です）。",
      "",
    );
  }

  lines.push(
    "---",
    "",
    `元の要望（管理画面・要ログイン）: ${adminUrl}`,
    "",
    "<!-- この指示文は改善要望の管理画面から自動生成されました。見出しの書式を変えると、後から機械で読むときに崩れます。 -->",
  );

  return {
    title,
    markdown: lines.join("\n"),
    structured: {
      id: item.id,
      title,
      kind,
      priority,
      screenLabel: item.screenLabel,
      routePattern: item.routePattern,
      sourceFile,
      request: outgoing(item.body),
      reproduction,
      acceptance,
      environment: d
        ? { browser: d.environment.browser, os: d.environment.os, viewport: d.environment.viewport }
        : null,
      errors: (d?.errors ?? []).map((e) => ({
        kind: e.kind,
        message: e.message,
        source: e.source ?? null,
        stack: e.stack ?? null,
      })),
      failedRequests: (d?.network ?? []).map((n) => ({
        method: n.method,
        endpoint: endpointOf(n.url),
        status: n.status,
        durationMs: n.durationMs,
        requestId: n.requestId ?? null,
        responseExcerpt: n.responseExcerpt ?? null,
      })),
      slowRequests: (d?.slowApi ?? []).map((n) => ({
        endpoint: endpointOf(n.url),
        durationMs: n.durationMs,
      })),
      consoleLog: (d?.console ?? []).map((c) => ({ level: c.level, at: c.at, text: c.message })),
      shotUrl: item.hasShot ? options.shotUrl : null,
      adminUrl,
      occurredAt: {
        jst: d?.occurredAt.jst ?? DIAGNOSTICS_UNAVAILABLE,
        utc: d?.occurredAt.utc ?? item.createdAt.toISOString(),
      },
      build: { id: d?.build.id ?? null, commit: d?.build.commit ?? null },
    },
  };
}

/* ───── 部品 ───── */

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function code(value: string | null | undefined): string {
  return value ? `\`${value}\`` : DIAGNOSTICS_UNAVAILABLE;
}

function foldable(summary: string, content: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${content}\n\n</details>`;
}

/**
 * 症状を1段落にまとめる。
 *
 * 「何が起きているか」を最初に読ませる。折りたたみの中の診断情報は根拠であって、
 * 先に全部読ませるものではない。
 */
function symptomOf(
  item: ImprovementDetail,
  d: StoredDiagnostics | null,
  kind: InstructionKind,
): string {
  const errors = d?.errors.length ?? 0;
  const failed = d?.network.length ?? 0;
  const slow = d?.slowApi.length ?? 0;
  const lines: string[] = [];

  if (kind === "不具合") {
    lines.push(
      `${item.screenLabel} の操作中に、例外 ${errors} 件・失敗した通信 ${failed} 件が出ています。**利用者の操作が途中で止まっている可能性があります。**`,
    );
    const first = d?.errors[0];
    if (first) lines.push("", `最初に出た例外: \`${first.message}\``);
    const firstFailed = d?.network[0];
    if (firstFailed) {
      lines.push(
        "",
        `最初に失敗した通信: \`${firstFailed.method} ${endpointOf(firstFailed.url)}\` → ${firstFailed.status ?? "通信できず"}`,
      );
    }
  } else if (kind === "要調査") {
    lines.push(
      `裏で例外は出ていませんが、通信が ${failed} 件失敗しています（いずれも 4xx）。入力の不足を伝えられていないか、条件の判定が実態と合っていない可能性があります。`,
    );
  } else {
    lines.push(
      "裏でのエラーは出ていません。動かないのではなく、使いにくさ・分かりにくさの指摘です。",
    );
  }
  if (slow > 0) lines.push("", `あわせて、3秒を超えた通信が ${slow} 件あります。`);
  return lines.join("\n");
}

function shotSection(
  item: ImprovementDetail,
  options: InstructionOptions,
  adminUrl: string,
): string {
  if (!item.hasShot) return "画像は付いていません（文章だけで送られた要望です）。";
  if (options.shotUrl) {
    return [
      `![${item.screenLabel}の画面の写し（送った人の書き込み入り）](${options.shotUrl})`,
      "",
      "表示されないときはこのURLを直接開いてください（期限つきです）:",
      options.shotUrl,
      "",
      "赤・橙・青の書き込みは送った本人の指摘、黒い塗りつぶしは本人が隠した部分です。",
      "黒い部分は画像そのものを塗りつぶしてあり、元の内容は残っていません。",
    ].join("\n");
  }
  return ["画像が付いていますが、この指示文からは開けません。", "", `管理画面で確認してください: ${adminUrl}`].join(
    "\n",
  );
}

function reproductionSteps(d: StoredDiagnostics | null): string[] {
  if (!d) return [];
  return d.breadcrumbs.map((c) => crumbText(c));
}

function crumbText(c: Breadcrumb): string {
  const at = c.at === DIAGNOSTICS_UNAVAILABLE ? "" : ` — ${c.at}`;
  switch (c.kind) {
    case "navigate":
      return `\`${c.target}\` を開く${at}`;
    case "submit":
      return `\`${c.target}\` を送信${at}`;
    case "input":
      return `\`${c.target}\` に入力${at}`;
    default:
      return `\`${c.target}\` を押す${at}`;
  }
}

function environmentTable(d: StoredDiagnostics): string {
  const e = d.environment;
  return [
    "| 項目 | 値 |",
    "| --- | --- |",
    `| ブラウザ | ${e.browser} |`,
    `| OS | ${e.os} |`,
    `| 画面の大きさ | ${e.viewport} |`,
  ].join("\n");
}

function errorSection(d: StoredDiagnostics): string {
  if (d.errors.length === 0) return "捕まえ損ねた例外はありません。";
  const parts: string[] = [];
  for (const e of d.errors) {
    parts.push(
      `- **${e.kind === "uncaught" ? "例外" : "後始末されなかった非同期処理"}** ${e.at}`,
      `  - ${e.message}`,
      ...(e.source ? [`  - 発生場所: \`${e.source}\``] : []),
      ...(e.stack ? ["", "```", e.stack, "```", ""] : []),
    );
  }
  return parts.join("\n");
}

/**
 * console の error / warn。
 *
 * GitHub の公開 Issue へ出していたときは件数だけにしていたが、
 * 指示文はアプリの外の公開領域へ出ないので中身まで載せる。
 * 直す人がここを見に戻る手間の方が、実務では高くつく。
 */
function consoleSection(d: StoredDiagnostics): string {
  if (d.console.length === 0) return "error / warn は出ていません。";
  return ["```", ...d.console.map((c) => `[${c.level}] ${c.at} ${c.message}`), "```"].join("\n");
}

/**
 * 実URL から、どの入り口かだけを取り出す。
 *
 * `/api/vehicles/42/monthly?year=2026` は `/api/vehicles/:id/monthly` になる。
 * どのAPIが失敗したかは分かり、どのデータかは分からない。
 */
export function endpointOf(url: string): string {
  const path = (url.split("?")[0] ?? "").replace(/^https?:\/\/[^/]+/, "");
  if (!path.startsWith("/")) return DIAGNOSTICS_UNAVAILABLE;
  return path
    .split("/")
    .map((segment) =>
      /^\d+$/.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment) || /^\d{4}-\d{2}/.test(segment)
        ? ":id"
        : segment,
    )
    .join("/");
}

function networkTable(entries: NetworkEntry[], emptyText: string): string {
  if (entries.length === 0) return emptyText;
  const rows = entries.map(
    (n) =>
      `| ${n.method} | \`${endpointOf(n.url)}\` | ${n.status ?? "通信できず"} | ${n.durationMs}ms | ${code(n.requestId)} | ${code(n.cfRay)} |`,
  );
  const excerpts = entries
    .filter((n) => n.responseExcerpt)
    .map((n) => `- \`${endpointOf(n.url)}\`: ${n.responseExcerpt}`);
  return [
    "| method | エンドポイント | status | 所要 | x-request-id | cf-ray |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    ...(excerpts.length > 0 ? ["", "応答の冒頭:", ...excerpts] : []),
  ].join("\n");
}

function performanceTable(d: StoredDiagnostics): string {
  const p = d.performance;
  return [
    "| 項目 | 値 |",
    "| --- | --- |",
    `| ページの読み込み | ${typeof p.pageLoadMs === "number" ? `${p.pageLoadMs}ms` : p.pageLoadMs} |`,
    `| APIの中央値 | ${typeof p.medianApiMs === "number" ? `${p.medianApiMs}ms` : p.medianApiMs} |`,
    `| 一番遅かったAPI | ${p.slowestApi ? `\`${endpointOf(p.slowestApi.url)}\` ${p.slowestApi.durationMs}ms` : "なし"} |`,
  ].join("\n");
}
