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

/**
 * Issue に載せないと決めたもの。
 *
 * 集める量・保存する量・外へ出す量は別々に決める。GitHub の Issue は
 * 編集しても履歴と通知メールが残り、実質取り消せない。読む人の範囲も管理画面と違う。
 * だから、管理画面では見えるが Issue には出さないものがある。
 *
 *  - 送った人の氏名・メールアドレス (誰が困ったかは管理画面で引く)
 *  - 会社名 (1社専用なので、そもそも保存もしない)
 *  - 実URL (IDが埋まっているため。route pattern だけ載せる)
 *  - 失敗した通信のレスポンス本文 (業務データそのものが混ざる)
 *  - console 出力の全件 (件数だけ載せ、中身は管理画面で読む)
 *
 * 足りない分は、末尾の管理画面リンクから必ずたどれるようにしてある。
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
    // 実URL は載せない。IDが埋まっていて、それ自体が誰の何かを指してしまう。
    `| route pattern | \`${item.routePattern}\` |`,
    `| 直すファイル (推定) | \`${d?.screen.sourceFile ?? sourceFileOf(item.routePattern)}\` |`,
    "",
    "## いつ・どの版で",
    "",
    `| 項目 | 値 |`,
    `| --- | --- |`,
    `| 発生時刻 (JST) | ${d?.occurredAt.jst ?? DIAGNOSTICS_UNAVAILABLE} |`,
    `| 発生時刻 (UTC) | ${d?.occurredAt.utc ?? item.createdAt.toISOString()} |`,
    // 氏名・利用者ID・会社は載せない。権限だけは、どの立場で開いた画面かで
    // 見え方が変わるため残す (誰かは特定できない)。
    `| 送った人の権限 | ${d?.reporter.role ?? DIAGNOSTICS_UNAVAILABLE} |`,
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
      foldable("捕まえ損ねた例外", errorSection(d)),
      "",
      foldable(
        "失敗した通信（相関IDつき・サーバのログと突き合わせる用）",
        networkTable(d.network, "失敗した通信はありません。"),
      ),
      "",
      foldable(
        "3秒を超えた通信",
        networkTable(d.slowApi, "3秒を超えた通信はありません。"),
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
  // 誰が送ったかは管理画面で分かる。ここでは人数だけ書く。
  const who = "利用者1名から報告";
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
      // private なリポジトリでは画像が展開されないことがある。そのときのために
      // 必ずリンクも併記する (見えないまま「画像なし」と誤解されないように)。
      `画像が表示されないときはこちら: ${options.shotUrl}`,
      "",
      "赤・橙・青の書き込みは送った本人の指摘、黒い塗りつぶしは本人が隠した部分です。",
      "黒い部分は画像そのものを塗りつぶしてあり、元の内容は残っていません。",
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

/**
 * 環境はブラウザ・OS・画面の大きさの3つだけ載せる。
 *
 * UserAgent や言語・タイムゾーン・表示倍率まで並べると、
 * 組み合わせで「どの端末の誰か」が絞れてしまう。再現に要るのはこの3つで足り、
 * 残りは管理画面で見られる。
 */
function environmentTable(d: StoredDiagnostics): string {
  const e = d.environment;
  return [
    "| 項目 | 値 |",
    "| --- | --- |",
    `| ブラウザ | ${e.browser} |`,
    `| OS | ${e.os} |`,
    `| 画面の大きさ | ${e.viewport} |`,
    "",
    "UserAgent・言語・タイムゾーンなどは管理画面で確認できます。",
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
  // console 出力は件数だけ。中身は管理画面で読む。
  // 業務の数字や画面の中身がそのまま文字列で出ていることがあり、
  // 全件を外へ貼ると、診断のための記録が持ち出し口になる。
  parts.push(
    "",
    `### console 出力: error ${countLevel(d, "error")}件 / warn ${countLevel(d, "warn")}件`,
    "",
    "中身は管理画面の「送信時の記録」で読めます（この Issue には貼りません）。",
  );
  return parts.join("\n");
}

function countLevel(d: StoredDiagnostics, level: "error" | "warn"): number {
  return d.console.filter((c) => c.level === level).length;
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
  // 実URL ではなくエンドポイント。応答の中身は載せない (業務データが混ざる)。
  const rows = entries.map(
    (n) =>
      `| ${n.method} | \`${endpointOf(n.url)}\` | ${n.status ?? "通信できず"} | ${n.durationMs}ms | ${code(n.requestId)} | ${code(n.cfRay)} |`,
  );
  const hasExcerpt = entries.some((n) => n.responseExcerpt);
  return [
    "| method | エンドポイント | status | 所要 | x-request-id | cf-ray |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    ...(hasExcerpt
      ? ["", "応答の中身は管理画面で確認してください（この Issue には貼りません）。"]
      : []),
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
