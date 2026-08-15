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
 * 外へ出す原文。
 *
 * 管理画面の中では原文をそのまま見せるが、Issue はアプリの外に出る。
 * 「パスワードの欄が…」のような普通の文章はそのまま残り、
 * `password=実際の値` のように値の形で書かれたものだけが伏せられる。
 * 本人が自分で書いたものでも、外へ出す一歩手前で一度ふるいにかける。
 */
function outgoing(text: string): string {
  return maskSensitive(text, IMPROVEMENT_BODY_MAX);
}

/**
 * 届いた改善要望を、そのまま直しに取りかかれる Issue の文面にする。
 *
 * ここが満たすべき条件は1つだけ。
 * 「この Issue を開いた人 (人でも AI でも) が、他のどこも見ずに着手できること」。
 * 元の要望を見に行かないと分からない情報が1つでもあると、
 * Issue は「通知」にしかならず、作業は結局2度手間になる。
 *
 * 逆に、長い診断情報を素で貼ると本文が読めなくなる。だから
 * 「人が最初に読む数行」と「機械が読む一式」を折りたたみで分ける。
 *
 * 通信は一切しない純粋な組み立て。だから起票せずに文面だけ確認できる
 * (dry-run) し、テストで文面そのものを固定できる。
 */

export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}

export interface IssueDraftOptions {
  /** 管理画面へ戻るためのURLを作る元 (例: https://example.workers.dev)。 */
  appOrigin: string;
  /**
   * Issue から画像を直接開くためのURL。用意できないときは null。
   * null のときは本文に管理画面への導線だけを載せる (画像を外へ出さない)。
   */
  shotUrl: string | null;
}

/** 状況の日本語。Issue では「まだ手が付いていないか」だけ分かればよい。 */
const STATUS_TEXT: Record<string, string> = {
  open: "未対応",
  doing: "対応中",
  done: "対応済み",
  dropped: "見送り",
};

/**
 * 不具合かどうかを、送った人の言葉ではなく診断情報から決める。
 *
 * 「使いにくい」と書かれていても裏で例外が出ているなら不具合であり、
 * 直す順番が変わる。人の申告だけに頼ると、この取り違えが起きる。
 */
export function issueLabelsOf(diagnostics: StoredDiagnostics | null): string[] {
  const labels = ["改善要望"];
  if (!diagnostics) return [...labels, "使いやすさ"];

  const hasException = diagnostics.errors.length > 0;
  const hasServerError = diagnostics.network.some((n) => n.status === null || n.status >= 500);
  const hasClientError = diagnostics.network.some(
    (n) => typeof n.status === "number" && n.status >= 400 && n.status < 500,
  );

  if (hasException || hasServerError) return [...labels, "不具合"];
  if (hasClientError) return [...labels, "要調査"];
  return [...labels, "使いやすさ"];
}

/** 見出しに出す一行。長い本文は切り、改行は潰す (Issue の一覧で読めるように)。 */
export function issueTitleOf(item: Pick<ImprovementDetail, "screenLabel" | "body">): string {
  const summary = outgoing(item.body).replace(/\s+/g, " ").trim();
  const cut = summary.length > 50 ? `${summary.slice(0, 50)}…` : summary;
  return `[改善要望] ${item.screenLabel}: ${cut}`;
}

export function buildIssueDraft(
  item: ImprovementDetail,
  options: IssueDraftOptions,
): IssueDraft {
  const d = item.diagnostics;
  const detailUrl = `${options.appOrigin.replace(/\/$/, "")}/admin/improvements/${item.id}`;

  const lines: string[] = [
    "## 利用者が書いたこと",
    "",
    // 要約しない。要約すると「そう言っていない」ことが独り歩きする。
    // 値の形をしたものだけ伏せる (outgoing 参照)。
    quote(outgoing(item.body)),
    "",
    "## どこの話か",
    "",
    `| 項目 | 値 |`,
    `| --- | --- |`,
    `| 画面 | ${item.screenLabel} |`,
    `| route pattern | \`${item.routePattern}\` |`,
    `| 実URL | \`${item.path}\` |`,
    `| 直すファイル (推定) | \`${d?.screen.sourceFile ?? sourceFileOf(item.routePattern)}\` |`,
    `| 遷移元 | ${code(d?.referrer)} |`,
    "",
    "## いつ・誰が・どの版で",
    "",
    `| 項目 | 値 |`,
    `| --- | --- |`,
    `| 発生時刻 (JST) | ${d?.occurredAt.jst ?? DIAGNOSTICS_UNAVAILABLE} |`,
    `| 発生時刻 (UTC) | ${d?.occurredAt.utc ?? item.createdAt.toISOString()} |`,
    `| 送った人 | ${item.reporterName || "利用者"}（権限: ${d?.reporter.role ?? DIAGNOSTICS_UNAVAILABLE}） |`,
    `| 利用者ID | ${code(d?.reporter.id)} |`,
    `| 組織 | ${d?.reporter.organization ?? DIAGNOSTICS_UNAVAILABLE} |`,
    `| アプリの版 | ${code(d?.build.id)} |`,
    `| コミット | ${code(d?.build.commit)} |`,
    `| 状況 | ${STATUS_TEXT[item.status] ?? item.status} |`,
    "",
    "## 影響の大きさ",
    "",
    influenceOf(item, d),
    "",
    "## 画面の写し",
    "",
    shotSection(item, options, detailUrl),
    "",
    "## 再現手順（送信直前の操作から）",
    "",
    reproductionOf(d),
    "",
  ];

  if (d) {
    lines.push(
      "## 診断情報",
      "",
      foldable("環境（ブラウザ・OS・画面）", environmentTable(d)),
      "",
      foldable("直近のエラーと console 出力", errorSection(d)),
      "",
      foldable("失敗した通信", networkTable(d.network, "失敗した通信はありません。")),
      "",
      foldable(
        "直近のAPI呼び出し（相関IDつき・サーバのログと突き合わせる用）",
        networkTable(d.api, "API の呼び出しはありません。"),
      ),
      "",
      foldable("速さ", performanceTable(d)),
      "",
    );
    if (d.notes.length > 0) {
      lines.push("> 診断情報についての注記: " + d.notes.join(" / "), "");
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
    `元の要望（管理画面）: ${detailUrl}`,
    "",
    "<!-- このIssueは改善要望の管理画面から自動生成されました。本文の書式を変えると、後から機械で読むときに崩れます。 -->",
  );

  return {
    title: issueTitleOf(item),
    body: lines.join("\n"),
    labels: issueLabelsOf(d),
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

function influenceOf(item: ImprovementDetail, d: StoredDiagnostics | null): string {
  const who = `${item.reporterName || "利用者"}（1名から報告）`;
  const errors = d?.errors.length ?? 0;
  const failed = d?.network.length ?? 0;
  const signal =
    errors > 0 || failed > 0
      ? `裏で例外 ${errors} 件・失敗した通信 ${failed} 件が出ています。**操作が止まっている可能性があります。**`
      : "裏でのエラーは出ていません。動かないのではなく、使いにくさの指摘と思われます。";
  return [
    `- 報告者: ${who}`,
    `- 同じ画面 (${item.routePattern}) への他の要望は、管理画面の絞り込みで数えられます。`,
    `- ${signal}`,
  ].join("\n");
}

function shotSection(
  item: ImprovementDetail,
  options: IssueDraftOptions,
  detailUrl: string,
): string {
  if (!item.hasShot) return "画像は付いていません（文章だけで送られた要望です）。";
  if (options.shotUrl) {
    return [
      `![${item.screenLabel}の画面の写し（送った人の書き込み入り）](${options.shotUrl})`,
      "",
      "赤・橙・青の書き込みは送った本人の指摘、黒い塗りつぶしは本人が隠した部分です。",
    ].join("\n");
  }
  // 画像を外へ出さない設定のとき。Issue には出さず、見る場所だけ示す。
  return [
    "画像が付いていますが、この Issue には載せていません（画像を社外から見える場所へ出さない設定のため）。",
    "",
    `画像はこちらで確認してください: ${detailUrl}`,
  ].join("\n");
}

function reproductionOf(d: StoredDiagnostics | null): string {
  if (!d || d.breadcrumbs.length === 0) {
    return "操作の足あとは記録されていません。";
  }
  const steps = d.breadcrumbs.map((c, i) => `${i + 1}. ${crumbText(c)}`);
  return [
    "送信の直前にたどった操作です（新しいものほど下）。値そのものは記録していません。",
    "",
    ...steps,
  ].join("\n");
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
    `| UserAgent | \`${e.userAgent}\` |`,
    `| 画面の大きさ | ${e.viewport} |`,
    `| devicePixelRatio | ${e.devicePixelRatio} |`,
    `| タッチ操作 | ${e.touch === true ? "はい" : e.touch === false ? "いいえ" : e.touch} |`,
    `| 言語 | ${e.language} |`,
    `| タイムゾーン | ${e.timezone} |`,
    `| 通信状態 | ${e.online === true ? "オンライン" : e.online === false ? "オフライン" : e.online} |`,
  ].join("\n");
}

function errorSection(d: StoredDiagnostics): string {
  const parts: string[] = [];
  if (d.errors.length === 0) {
    parts.push("捕まえ損ねた例外はありません。");
  } else {
    parts.push("### 捕まえ損ねた例外", "");
    for (const e of d.errors) {
      parts.push(
        `- **${e.kind === "uncaught" ? "例外" : "後始末されなかった非同期処理"}** ${e.at}`,
        `  - ${e.message}`,
        ...(e.source ? [`  - 発生場所: \`${e.source}\``] : []),
        ...(e.stack ? ["", "```", e.stack, "```", ""] : []),
      );
    }
  }
  parts.push("", "### console 出力（新しいものほど下）", "");
  if (d.console.length === 0) {
    parts.push("記録されていません。");
  } else {
    for (const c of d.console) {
      parts.push(`- \`${c.level}\` ${c.at} — ${c.message}`);
      if (c.stack) parts.push("", "```", c.stack, "```", "");
    }
  }
  return parts.join("\n");
}

function networkTable(entries: NetworkEntry[], emptyText: string): string {
  if (entries.length === 0) return emptyText;
  const rows = entries.map(
    (n) =>
      `| ${n.method} | \`${n.url}\` | ${n.status ?? "通信できず"} | ${n.durationMs}ms | ${code(n.requestId)} | ${code(n.cfRay)} |`,
  );
  const excerpts = entries
    .filter((n) => n.responseExcerpt)
    .map((n) => `- \`${n.url}\` の応答: \`${n.responseExcerpt}\``);
  return [
    "| method | URL | status | 所要 | x-request-id | cf-ray |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    ...(excerpts.length > 0 ? ["", "**応答の冒頭（マスク済み）**", ...excerpts] : []),
  ].join("\n");
}

function performanceTable(d: StoredDiagnostics): string {
  const p = d.performance;
  return [
    "| 項目 | 値 |",
    "| --- | --- |",
    `| ページの読み込み | ${typeof p.pageLoadMs === "number" ? `${p.pageLoadMs}ms` : p.pageLoadMs} |`,
    `| APIの中央値 | ${typeof p.medianApiMs === "number" ? `${p.medianApiMs}ms` : p.medianApiMs} |`,
    `| 一番遅かったAPI | ${p.slowestApi ? `\`${p.slowestApi.url}\` ${p.slowestApi.durationMs}ms` : "なし"} |`,
  ].join("\n");
}
