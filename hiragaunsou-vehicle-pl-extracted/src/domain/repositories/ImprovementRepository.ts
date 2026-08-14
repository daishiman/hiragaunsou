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
  createdAt: Date;
}

/** 詳細で出す1件。ここで初めて画像を読む。 */
export interface ImprovementDetail extends ImprovementListItem {
  viewport: string | null;
  userAgent: string | null;
  shot: string | null;
  handledByName: string | null;
  handledAt: Date | null;
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
}
