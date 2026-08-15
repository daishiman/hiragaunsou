import type { StoredDiagnostics } from "../rules/diagnostics";
import type { ImprovementStatus } from "../rules/improvement";
import type { InstructionState, StoredInstruction } from "../rules/improvementInstructionSync";

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
  /** 発行済みの指示文 (未発行なら null)。一覧で「もう渡した要望か」が分かる。 */
  instruction: StoredInstruction | null;
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
    | "instruction_publish"
    | "instruction_revise"
    | "instruction_withdraw"
    /** Claude Code が指示文を読み取った記録。誰が読んだかは鍵の名前で残す。 */
    | "instruction_fetch"
    | "token_issue"
    | "token_revoke"
    /** 保存期間を過ぎて、画面の写しと診断情報を自動で消した記録。 */
    | "retention_sweep";
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
  /* ── 指示文の発行 ── */

  /**
   * 発行の作業に取りかかる権利を1人だけに渡す。
   *
   * true が返った人だけが指示文を書き込んでよい。同時に押されたとき、
   * 版が競って上書きし合うのを防ぐ。落ちたまま印が残らないよう、
   * 取りかかった時刻が古くなったら空いたものとして扱う。
   */
  beginPublishing(id: string, leaseMs: number): Promise<boolean>;
  /** 発行に失敗したときに印を外す。次の人がすぐ試せるようにする。 */
  releasePublishing(id: string): Promise<void>;

  /**
   * 発行した指示文を書き込む。取り下げてあったものは、ここで発行済みに戻る。
   * 版が期待どおりでなければ (誰かが先に上げていたら) 何もせず false を返す。
   */
  markPublished(
    id: string,
    input: {
      version: number;
      hash: string;
      syncedFields: string;
      publishedById: string;
    },
  ): Promise<boolean>;

  /** Claude Code が読み取ったことを控える (取込済みにする)。 */
  markFetched(ids: string[]): Promise<void>;

  /** 発行済みの指示文を取り下げる。読めなくなるが、版と記録は残す。 */
  withdrawInstruction(id: string): Promise<void>;

  /* ── 一括操作でだけ使うもの ── */

  /**
   * 選ばれた件をまとめて読む。画像そのものは読まない (25件分の画像は数十MBになる)。
   * 画像が要る場面だけ findShot で1件ずつ取る。
   */
  findManyByIds(ids: string[]): Promise<ImprovementDetail[]>;
  findShot(id: string): Promise<string | null>;

  /** 指示文の状態だけを直接書き換える (取り込みの記録など)。 */
  setInstructionState(id: string, state: InstructionState): Promise<void>;

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

  /**
   * 保存期間を過ぎた分の、画面の写しと診断情報だけを消す (本文と記録は残す)。
   *
   * 完全削除と同じで、写しだけ残る・診断情報だけ残るという中途半端な状態を作らない。
   * 同じ要望の2つを1つの batch で消し、消した要望の id を返す (記録を書くために使う)。
   * limit で1回に扱う量を切る。残った分は次の掃除で続きから消える。
   */
  sweepExpiredAttachments(
    cutoff: Date,
    limit: number,
  ): Promise<{ requestIds: string[]; shots: number; diagnostics: number }>;

  /** 操作の記録を残す。完全削除しても消えない表に書く。 */
  appendAudit(entries: ImprovementAuditEntry[]): Promise<void>;

  /** 1件に対して行われた操作の記録 (新しい順)。 */
  auditOf(requestId: string): Promise<
    (ImprovementAuditEntry & { at: Date })[]
  >;
}
