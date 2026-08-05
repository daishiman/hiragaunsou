import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { user, session } from "./auth-schema";
import type { UserRepository, UserSummary } from "../../domain/repositories/UserRepository";
import type { Role } from "../../domain/rules/permissions";

/** D1(Drizzle)によるUserRepositoryの実装(Infrastructure層アダプタ)。 */
export class D1UserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<UserSummary[]> {
    const rows = await this.db.select().from(user);
    return rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role ?? "input_staff",
        banned: r.banned,
        createdAt: r.createdAt.getTime(),
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async findById(id: string): Promise<UserSummary | null> {
    const rows = await this.db.select().from(user).where(eq(user.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role ?? "input_staff",
      banned: row.banned,
      createdAt: row.createdAt.getTime(),
    };
  }

  async findByEmail(email: string): Promise<UserSummary | null> {
    const rows = await this.db.select().from(user).where(eq(user.email, email)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role ?? "input_staff",
      banned: row.banned,
      createdAt: row.createdAt.getTime(),
    };
  }

  async updateRoleAndBanned(id: string, input: { role?: Role; banned?: boolean }): Promise<void> {
    const set: Partial<typeof user.$inferInsert> = {};
    if (input.role !== undefined) set.role = input.role;
    if (input.banned !== undefined) set.banned = input.banned;
    if (Object.keys(set).length === 0) return;
    await this.db.update(user).set(set).where(eq(user.id, id));
  }

  async updateName(id: string, name: string): Promise<void> {
    await this.db.update(user).set({ name }).where(eq(user.id, id));
  }

  async deleteSessions(userId: string): Promise<void> {
    await this.db.delete(session).where(eq(session.userId, userId));
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.delete(user).where(eq(user.id, id));
  }
}
