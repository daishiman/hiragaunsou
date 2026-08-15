import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { improvementAccessToken } from "./schema";
import type {
  InstructionTokenRecord,
  InstructionTokenRepository,
  InstructionTokenSummary,
} from "../../domain/repositories/InstructionTokenRepository";
import { parseScopeIds } from "../../domain/rules/instructionAccess";

type Row = typeof improvementAccessToken.$inferSelect;

function toSummary(r: Row): InstructionTokenSummary {
  return {
    id: r.id,
    name: r.name,
    scopeIds: parseScopeIds(r.scopeIds),
    createdByName: r.createdByName,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    revokedReason: r.revokedReason,
    lastUsedAt: r.lastUsedAt,
    useCount: r.useCount,
  };
}

/**
 * D1(Drizzle)による InstructionTokenRepository の実装。
 *
 * この表には平文の鍵を入れない。入れてよいのは指紋だけで、照合も指紋どうしで行う。
 * 「鍵を見せてください」という問い合わせに答えられない作りにしてある。
 */
export class D1InstructionTokenRepository implements InstructionTokenRepository {
  constructor(private readonly db: Db) {}

  async issue(input: {
    id: string;
    name: string;
    tokenHash: string;
    scopeIds: string[];
    createdById: string;
    createdByName: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(improvementAccessToken).values({
      id: input.id,
      name: input.name,
      tokenHash: input.tokenHash,
      scopeIds: JSON.stringify(input.scopeIds),
      createdById: input.createdById,
      createdByName: input.createdByName,
      expiresAt: input.expiresAt,
    });
  }

  async list(): Promise<InstructionTokenSummary[]> {
    const rows = await this.db
      .select()
      .from(improvementAccessToken)
      .orderBy(desc(improvementAccessToken.createdAt));
    return rows.map(toSummary);
  }

  async findByHash(tokenHash: string): Promise<InstructionTokenRecord | null> {
    const rows = await this.db
      .select()
      .from(improvementAccessToken)
      .where(eq(improvementAccessToken.tokenHash, tokenHash))
      .limit(1);
    const r = rows[0];
    return r ? { ...toSummary(r), tokenHash: r.tokenHash } : null;
  }

  /**
   * 失効させる。まだ生きている行だけを対象にするので、二重に押しても
   * 最初に失効させた時刻と理由が上書きされない。
   */
  async revoke(id: string, reason: string): Promise<boolean> {
    const result = await this.db
      .update(improvementAccessToken)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(eq(improvementAccessToken.id, id), isNull(improvementAccessToken.revokedAt)),
      )
      .returning({ id: improvementAccessToken.id });
    return result.length > 0;
  }

  async revokeForRequests(requestIds: string[], reason: string): Promise<string[]> {
    if (requestIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(improvementAccessToken)
      .where(isNull(improvementAccessToken.revokedAt));

    // 範囲は JSON 文字列で持っているので、突き合わせはこちらで行う。
    // 鍵の本数はたかだか数十件なので、SQL 側で解く形にする利点が無い。
    const targets = rows.filter((r) => {
      const scope = parseScopeIds(r.scopeIds);
      return scope.length > 0 && scope.some((id) => requestIds.includes(id));
    });
    if (targets.length === 0) return [];

    await this.db
      .update(improvementAccessToken)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        inArray(
          improvementAccessToken.id,
          targets.map((r) => r.id),
        ),
      );
    return targets.map((r) => r.name || r.id);
  }

  async touch(id: string): Promise<void> {
    await this.db
      .update(improvementAccessToken)
      .set({
        lastUsedAt: new Date(),
        useCount: sql`${improvementAccessToken.useCount} + 1`,
      })
      .where(eq(improvementAccessToken.id, id));
  }
}
