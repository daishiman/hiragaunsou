import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { userInvitation } from "./schema";
import { user } from "./auth-schema";
import type {
  CreateInvitationInput,
  Invitation,
  InvitationAuthMethod,
  InvitationRepository,
} from "../../domain/repositories/InvitationRepository";
import type { Role } from "../../domain/rules/permissions";

/** D1(Drizzle)によるInvitationRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1InvitationRepository implements InvitationRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<Invitation[]> {
    const rows = await this.db
      .select({
        id: userInvitation.id,
        email: userInvitation.email,
        role: userInvitation.role,
        invitedBy: userInvitation.invitedBy,
        invitedByName: user.name,
        createdAt: userInvitation.createdAt,
        acceptedAt: userInvitation.acceptedAt,
        revoked: userInvitation.revoked,
        authMethod: userInvitation.authMethod,
      })
      .from(userInvitation)
      .leftJoin(user, eq(userInvitation.invitedBy, user.id));

    return rows
      .map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role as Role,
        invitedBy: r.invitedBy,
        invitedByName: r.invitedByName,
        createdAt: r.createdAt.getTime(),
        acceptedAt: r.acceptedAt ? r.acceptedAt.getTime() : null,
        revoked: r.revoked,
        authMethod: r.authMethod as InvitationAuthMethod,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async findPendingByEmail(email: string): Promise<Invitation | null> {
    const rows = await this.db
      .select()
      .from(userInvitation)
      .where(
        and(
          eq(userInvitation.email, email),
          eq(userInvitation.revoked, false),
          isNull(userInvitation.acceptedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      role: row.role as Role,
      invitedBy: row.invitedBy,
      invitedByName: null,
      createdAt: row.createdAt.getTime(),
      acceptedAt: row.acceptedAt ? row.acceptedAt.getTime() : null,
      revoked: row.revoked,
      authMethod: row.authMethod as InvitationAuthMethod,
    };
  }

  async upsert(input: CreateInvitationInput): Promise<void> {
    await this.db
      .insert(userInvitation)
      .values({
        id: crypto.randomUUID(),
        email: input.email,
        role: input.role,
        invitedBy: input.invitedBy,
        authMethod: input.authMethod,
      })
      .onConflictDoUpdate({
        target: userInvitation.email,
        set: {
          role: input.role,
          invitedBy: input.invitedBy,
          createdAt: new Date(),
          acceptedAt: null,
          revoked: false,
          authMethod: input.authMethod,
        },
      });
  }

  async revoke(id: string): Promise<void> {
    await this.db.update(userInvitation).set({ revoked: true }).where(eq(userInvitation.id, id));
  }

  async markAccepted(email: string): Promise<void> {
    await this.db
      .update(userInvitation)
      .set({ acceptedAt: new Date() })
      .where(eq(userInvitation.email, email));
  }
}
