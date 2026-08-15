import type { StoredDiagnostics } from "../rules/diagnostics";
import type { ImprovementStatus } from "../rules/improvement";

/** 画面から届いた1件の要望 (保存する前の形)。 */
export interface ImprovementSubmission {
  reporterId: string;
  reporterName: string;
  /** ブラウザが送信のたびに作る鍵。再送を1件にまとめるために使う。 */
  submissionKey: string;
  path: string;
  routePattern: string;
  screenLabel: string;
  body: string;
  viewport: string | null;
  userAgent: string | null;
  /** 注釈・黒塗りを焼き込んだ後の画像 (data URL)。文章だけの投稿は null。 */
  shot: string | null;
  shotBytes: number;
  /** 裏で集めた診断情報。集められなかったときは null (要望自体は受け取る)。 */
  diagnostics: StoredDiagnostics | null;
}

/** 一覧に出す1行。画像は含めない (一覧で全件の画像を読まないため)。 */
export interface ImprovementListItem {
  id: string;
  status: ImprovementStatus;
  path: string;
  routePattern: string;
  screenLabel: string;
  body: string;
  reporterName: string;
  handledNote: string | null;
  hasShot: boolean;
  /** 起票済みなら Issue 番号。一覧で「もう上げた要望か」が分かる。 */
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  /** 最後に確かめた GitHub 側の状態 (open / closed / missing)。 */
  githubIssueState: string | null;
  /** 最後に Issue へ送った日時。これより後に更新されていれば「更新あり」。 */
  githubSyncedAt: Date | null;
  /** 廃棄した日時。null なら通常の一覧に並ぶ。 */
  archivedAt: Date | null;
  /** 「重複」にしたときのまとめ先。 */
  duplicateOfId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 詳細で出す1件。ここで初めて画像と診断情報を読む。 */
export interface ImprovementDetail extends ImprovementListItem {
  viewport: string | null;
  userAgent: string | null;
  shot: string | null;
  handledByName: string | null;
  handledAt: Date | null;
  diagnostics: StoredDiagnostics | null;
  /** GitHub へ起票済みなら、その番号とURL。 */
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  githubIssuedAt: Date | null;
  /** 前回 Issue へ送った内容の指紋と、そのときの値の控え。 */
  githubContentHash: string | null;
  githubSyncedFields: string | null;
}

/** 状態を変えた・廃棄した・消した記録。完全削除しても残す。 */
export interface ImprovementAuditEntry {
  requestId: string;
  actorId: string | null;
  actorName: string;
  action:
    | "status_change"
    | "archive"
    | "restore"
    | "purge"
    | "issue_create"
    | "issue_update"
    | "issue_close";
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
}

export interface ImprovementRepository {
  /** 本文と画像を1つのまとまりとして保存する。同じ送信キーの再送は1件に収める。 */
  save(input: ImprovementSubmission): Promise<string>;
  /** 同じ投稿者・同じ送信キーで既に保存済みなら、その id を返す。 */
  findBySubmissionKey(reporterId: string, submissionKey: string): Promise<string | null>;
  listAll(): Promise<ImprovementListItem[]>;
  findById(id: string): Promise<ImprovementDetail | null>;
  updateHandling(
    id: string,
    input: { status: ImprovementStatus; note: string | null; handledById: string },
  ): Promise<void>;
  /**
   * 起票の作業に取りかかる権利を1人だけに渡す。
   *
   * true が返った人だけが GitHub へ投げてよい。番号は投げた後にしか分からないため、
   * 番号の列だけでは「投げている最中の2回目」を止められない。
   * 落ちたまま印が残らないよう、取りかかった時刻が古くなったら空いたものとして扱う。
   */
  beginIssuing(id: string, leaseMs: number): Promise<boolean>;
  /** 起票に失敗したときに印を外す。次の人がすぐ試せるようにする。 */
  releaseIssuing(id: string): Promise<void>;
  /**
   * 起票した Issue を1件に結び付ける。
   *
   * 既に結び付いていれば書き換えず false を返す。押し直しや二重送信で
   * Issue が増えるのを、画面の制御ではなく保存の側で止めるため。
   */
  markIssued(
    id: string,
    input: {
      issueNumber: number;
      issueUrl: string;
      issuedById: string;
      contentHash: string;
      syncedFields: string;
    },
  ): Promise<boolean>;

  /* ── 一括起票と一生の管理でだけ使うもの ── */

  /**
   * 選ばれた件をまとめて読む。画像そのものは読まない (25件分の画像は数十MBになる)。
   * 画像が要る場面 (Issue へ貼る設定のとき) だけ findShot で1件ずつ取る。
   */
  findManyByIds(ids: string[]): Promise<ImprovementDetail[]>;
  findShot(id: string): Promise<string | null>;

  /** 更新した Issue の指紋と控えを書き戻す。番号は変えない。 */
  markIssueSynced(
    id: string,
    input: { contentHash: string; syncedFields: string; state: string | null },
  ): Promise<void>;

  /** GitHub 側で見えた状態 (open / closed / missing) を控える。 */
  markIssueState(id: string, state: string): Promise<void>;

  /**
   * 見つからなくなった Issue との結び付きを外す。
   * 外さないと、その要望は以後ずっと更新も作成もできない番号を握り続ける。
   */
  detachIssue(id: string): Promise<void>;

  /** 状態・理由・まとめ先・廃棄を1件に反映する。 */
  updateLifecycle(
    id: string,
    input: {
      status?: ImprovementStatus;
      note?: string | null;
      duplicateOfId?: string | null;
      archivedAt?: Date | null;
      actorId: string;
    },
  ): Promise<void>;

  /**
   * 本文・画像・診断情報をまとめて消す (完全削除)。
   * 画像だけが残る・記録だけが残る状態を作らないよう、1つの batch で消す。
   */
  purge(ids: string[]): Promise<void>;

  /** 操作の記録を残す。完全削除しても消えない表に書く。 */
  appendAudit(entries: ImprovementAuditEntry[]): Promise<void>;

  /** 1件に対して行われた操作の記録 (新しい順)。 */
  auditOf(requestId: string): Promise<
    (ImprovementAuditEntry & { at: Date })[]
  >;
}
