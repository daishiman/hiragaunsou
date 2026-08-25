/**
 * 指示文を読むための鍵の保管。
 *
 * 平文の鍵はどこにも保存しない。保存するのは指紋 (SHA-256) だけで、
 * 平文は発行した瞬間に画面へ1度出すきりにする。DB を読める人が、そのまま
 * 指示文を読める鍵を手に入れられる状態を作らないため。
 */

import type { TokenAbility } from "../rules/instructionAccess";

/** 一覧に出す1件。平文の鍵は含まない (発行時以外はどこからも取り出せない)。 */
export interface InstructionTokenSummary {
  id: string;
  name: string;
  /** 開けてよい要望の id。空配列なら発行済みのすべて。 */
  scopeIds: string[];
  /** できること (read / status:own / status:any)。 */
  abilities: TokenAbility[];
  /** 属する会社。単一テナントのいまは必ず null (マルチテナント化時の焼き込み先)。 */
  companyId: string | null;
  createdByName: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  lastUsedAt: Date | null;
  useCount: number;
}

/** 鍵を照合した結果。期限切れ・失効の判定は domain 側の tokenRejection が行う。 */
export interface InstructionTokenRecord extends InstructionTokenSummary {
  tokenHash: string;
}

export interface InstructionTokenRepository {
  /** 鍵を作る。渡すのは指紋だけで、平文はここへ来ない。 */
  issue(input: {
    id: string;
    name: string;
    tokenHash: string;
    scopeIds: string[];
    createdById: string;
    createdByName: string;
    expiresAt: Date;
    abilities: TokenAbility[];
    /** 単一テナントのいまは null 固定。マルチテナント化時にここへ会社IDを入れる。 */
    companyId: string | null;
  }): Promise<void>;

  /**
   * その鍵が指示文を読み取ったことを控える。
   *
   * 「自分が取得した要望だけ状態を進められる」の根拠になる記録。
   * 同じ件を読み直しても増えないよう、既にあれば何もしない。
   */
  recordClaims(tokenId: string, requestIds: string[]): Promise<void>;

  /** その鍵がその要望を読み取っているか。 */
  hasClaim(tokenId: string, requestId: string): Promise<boolean>;

  /** 管理画面に出す一覧 (新しい順)。失効済みも含めて出す。 */
  list(): Promise<InstructionTokenSummary[]>;

  /** 指紋から1件引く。見つからなければ null。 */
  findByHash(tokenHash: string): Promise<InstructionTokenRecord | null>;

  /** 鍵を失効させる。既に失効しているものは何もしない (二重押しで記録が動かない)。 */
  revoke(id: string, reason: string): Promise<boolean>;

  /**
   * ある要望を含む鍵をまとめて失効させる。
   * 要望を完全削除したのに、それを読める鍵が生きたままになるのを防ぐ。
   * 全件を読める鍵 (範囲が空) は対象にしない。1件消すたびに全体の鍵が死ぬのは行きすぎ。
   * 失効させた鍵の名前を返す (記録に何を止めたか書くため)。
   */
  revokeForRequests(requestIds: string[], reason: string): Promise<string[]>;

  /** 使われたことを控える (最終使用時刻と回数)。 */
  touch(id: string): Promise<void>;
}
