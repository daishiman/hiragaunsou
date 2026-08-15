/**
 * 改善要望 (各画面から届く「ここが使いにくい」) の決まりごと。
 *
 * 画面・API・管理一覧のどこから見ても同じ判断になるよう、状態・上限・画像の検査・
 * 絞り込み・集計をここ1箇所に集める。DOM も DB も持ち込まない純粋な計算だけを置く
 * (Domain 層の約束)。
 *
 * このアプリは平賀運送1社だけを扱う(会社テーブルを持たない)。参考にした
 * 人事評価システムにあった「会社境界」の判定はここには要らない。代わりに
 * 「読めるのは管理者だけ」を権限1本で守る。
 */

/* ───────────────────────── 状態 ───────────────────────── */

export const IMPROVEMENT_STATUSES = [
  "open",
  "doing",
  "review",
  "done",
  "dropped",
  "invalid",
  "duplicate",
] as const;
export type ImprovementStatus = (typeof IMPROVEMENT_STATUSES)[number];

const STATUS_LABEL: Record<ImprovementStatus, string> = {
  open: "未対応",
  doing: "対応中",
  review: "レビュー待ち",
  done: "対応済み",
  dropped: "見送り",
  invalid: "誤作成",
  duplicate: "重複",
};

/** 画面に出す状態の呼び名。DBの値(open など)は画面に出さない。 */
export function improvementStatusLabel(status: ImprovementStatus): string {
  return STATUS_LABEL[status];
}

/**
 * 状態の札の色。色相は増やさない (docs/design-system.md §2) ので4つの中から選ぶ。
 * 色だけで意味を伝えないよう、札には必ず上の呼び名を一緒に出す。
 *   未対応   caution — 読んで判断が要る
 *   対応中/レビュー待ち/対応済み brand — 手が入っている・終わっている
 *   見送り/誤作成/重複 neutral — 良し悪しではなく分類 (色で咎めない)
 *
 * レビュー待ちを brand に寄せるのは、これが「止まっている」ではなく
 * 「直し終えて確認を待っている」状態だから。caution にすると、対応中より
 * 先へ進んだのに札が後戻りして見え、一覧の並びと印象が食い違う。
 */
export function improvementStatusTone(
  status: ImprovementStatus,
): "danger" | "caution" | "brand" | "neutral" {
  if (status === "open") return "caution";
  if (status === "dropped" || status === "invalid" || status === "duplicate") return "neutral";
  return "brand";
}

/** 保存されている文字列が、扱ってよい状態かどうか。 */
export function isImprovementStatus(value: string): value is ImprovementStatus {
  return (IMPROVEMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * 状態と対応メモを一緒に保存するときの業務ルール。
 *
 * 「対応済み」「見送り」で終わりにはしない。取り違えて閉じたときに元へ戻せないと、
 * 要望そのものが消えたのと同じになるため、どの状態からでも戻せる。
 * 禁じるのは「何も変わらない保存」だけ (同じ状態・同じメモの押し直し)。
 * 見送り・誤作成・重複は理由を必須にする。理由の無いまま脇へ寄せられた要望は、
 * 送った人から見れば黙殺と同じで、後から見た人にも判断のやり直しができない。
 */
export const REASON_REQUIRED_STATUSES = ["dropped", "invalid", "duplicate"] as const;

/** その状態にするとき、理由の入力が要るか。 */
export function requiresReason(status: ImprovementStatus): boolean {
  return (REASON_REQUIRED_STATUSES as readonly string[]).includes(status);
}

export function improvementHandlingError(
  currentStatus: ImprovementStatus,
  currentNote: string | null,
  nextStatus: ImprovementStatus,
  nextNote: string | null,
): string | null {
  const before = currentNote?.trim() ?? "";
  const after = nextNote?.trim() ?? "";
  if (requiresReason(nextStatus) && after.length === 0) {
    return `「${improvementStatusLabel(nextStatus)}」にする理由を入力してください。`;
  }
  if (currentStatus === nextStatus && before === after) return "変更する内容がありません。";
  return null;
}

/* ───────────────────────── 本文と画像の上限 ───────────────────────── */

/** 本文の上限。1件で仕様書を書かせない (長い話は打ち合わせで受ける)。 */
export const IMPROVEMENT_BODY_MAX = 1000;

/** 対応メモの上限。 */
export const IMPROVEMENT_NOTE_MAX = 1000;

/**
 * 画像1枚の上限。D1 の1行に収める前提の大きさにする
 * (D1 は1つの値が 1,000,000 バイトを超えると書き込めない)。
 * 送る側 (ブラウザ) で縮小と圧縮をしてからこの検査を通す。
 */
export const IMPROVEMENT_SHOT_MAX_BYTES = 700_000;

/** リクエスト全体の上限。画像を含む投稿が Worker のメモリを無制限に使わないための境界。 */
export const IMPROVEMENT_REQUEST_MAX_BYTES = 960_000;

/** data URL の文字数から、元の画像のバイト数を見積もる。 */
export function shotBytesOf(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const body = dataUrl.slice(comma + 1);
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/**
 * 受け取ってよい画像かどうか (形式・大きさ・中身の先頭バイト)。
 *
 * 拡張子や content-type の名乗りだけでは、画像に見せかけた別の中身を止められない。
 * 先頭の決まったバイト列 (magic bytes) まで見て、本当にその形式かを確かめる。
 */
export function isAcceptableShot(dataUrl: string): boolean {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  const format = match?.[1];
  const base64 = match?.[2];
  if (!format || !base64 || base64.length % 4 !== 0) return false;
  if (shotBytesOf(dataUrl) > IMPROVEMENT_SHOT_MAX_BYTES) return false;
  try {
    const decoded = atob(base64);
    const has = (...signature: number[]) =>
      signature.every((value, index) => decoded.charCodeAt(index) === value);
    if (format === "png") return has(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    if (format === "jpeg") return has(0xff, 0xd8, 0xff);
    return has(0x52, 0x49, 0x46, 0x46) && decoded.slice(8, 12) === "WEBP";
  } catch {
    return false;
  }
}

/** 入力された本文を保存できる形に整える。長さは呼び出し側が拒否し、ここでは黙って切らない。 */
export function normalizeImprovementBody(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trim();
}

/* ───────────────────────── 一覧の絞り込みと集計 ───────────────────────── */

export interface ImprovementRow {
  id: string;
  status: ImprovementStatus;
  path: string;
  routePattern: string;
  screenLabel: string;
  createdAt: Date;
  /** 廃棄した日時。null なら通常の一覧に並ぶ。 */
  archivedAt?: Date | null;
}

export interface ImprovementFilter {
  /** null は「すべての状態」 */
  status?: ImprovementStatus | null;
  /** null は「すべての画面」 */
  routePattern?: string | null;
  /** この日時より後に届いたものだけ */
  since?: Date | null;
  /**
   * 廃棄したものの扱い。既定 ("active") は隠す。
   * 押し間違いで廃棄したものを探せなくならないよう、"archived" で切り替えられる。
   */
  archive?: "active" | "archived" | "all";
}

/** 一覧の絞り込み。画面と API で同じ結果になるよう、ここだけで判定する。 */
export function filterImprovements<T extends ImprovementRow>(rows: T[], filter: ImprovementFilter): T[] {
  const archive = filter.archive ?? "active";
  return rows.filter((r) => {
    const archived = r.archivedAt != null;
    if (archive === "active" && archived) return false;
    if (archive === "archived" && !archived) return false;
    if (filter.status && r.status !== filter.status) return false;
    if (filter.routePattern && r.routePattern !== filter.routePattern) return false;
    if (filter.since && r.createdAt.getTime() < filter.since.getTime()) return false;
    return true;
  });
}

/** 状態ごとの件数。0件の状態も0として必ず並べる (欠けた札を作らない)。 */
export function countImprovementsByStatus(rows: ImprovementRow[]): Record<ImprovementStatus, number> {
  // 一覧を手で書き写さない。状態を1つ足したときに、ここだけ直し忘れて
  // 「札は出るのに件数が数えられない」状態になるのを防ぐ。
  const counts = Object.fromEntries(IMPROVEMENT_STATUSES.map((s) => [s, 0])) as Record<
    ImprovementStatus,
    number
  >;
  for (const r of rows) counts[r.status] += 1;
  return counts;
}

/**
 * 「どの画面から届いたか」の集計。多い順に並べ、同数なら画面名の順にする。
 *
 * 集計の単位は実URL (/vehicle/1177) ではなく画面 (/vehicle/[vehicleNo])。
 * 実URLで数えると、同じ画面への同じ指摘が車番の数だけ分かれて、
 * 「どの画面が一番困られているか」が読めなくなる。
 */
export function groupImprovementsByScreen(
  rows: ImprovementRow[],
): { routePattern: string; screenLabel: string; count: number }[] {
  const map = new Map<string, { routePattern: string; screenLabel: string; count: number }>();
  for (const r of rows) {
    const hit = map.get(r.routePattern);
    if (hit) hit.count += 1;
    else map.set(r.routePattern, { routePattern: r.routePattern, screenLabel: r.screenLabel, count: 1 });
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.screenLabel.localeCompare(b.screenLabel, "ja"),
  );
}

/** 期間の絞り込みの選択肢。 */
export const IMPROVEMENT_PERIODS = ["7d", "30d", "all"] as const;
export type ImprovementPeriod = (typeof IMPROVEMENT_PERIODS)[number];

export const IMPROVEMENT_PERIOD_LABEL: Record<ImprovementPeriod, string> = {
  "7d": "この7日",
  "30d": "この30日",
  all: "すべて",
};

/** 期間の選択から、切り出す起点の日時を出す。「すべて」は起点なし。 */
export function improvementPeriodStart(period: ImprovementPeriod, now: Date): Date | null {
  if (period === "all") return null;
  const days = period === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** 受け取った文字列が、扱ってよい期間かどうか。 */
export function isImprovementPeriod(value: string): value is ImprovementPeriod {
  return (IMPROVEMENT_PERIODS as readonly string[]).includes(value);
}
