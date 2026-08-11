import { describe, expect, it } from "vitest";
import type {
  CreateInvitationInput,
  Invitation,
  InvitationRepository,
} from "../../src/domain/repositories/InvitationRepository";
import type { UserRepository, UserSummary } from "../../src/domain/repositories/UserRepository";
import {
  CreateInvitationUseCase,
  ListInvitationsUseCase,
  RevokeInvitationUseCase,
} from "../../src/usecase/steps/manageInvitations";

function fakeInvitationRepo(): InvitationRepository & { rows: Map<string, Invitation> } {
  const rows = new Map<string, Invitation>();
  let seq = 0;
  return {
    rows,
    async list() {
      return [...rows.values()];
    },
    async findPendingByEmail(email) {
      return [...rows.values()].find((i) => i.email === email && !i.revoked && !i.acceptedAt) ?? null;
    },
    async upsert(input: CreateInvitationInput) {
      const existing = [...rows.values()].find((i) => i.email === input.email);
      const id = existing?.id ?? `inv-${seq++}`;
      rows.set(id, {
        id,
        email: input.email,
        role: input.role,
        invitedBy: input.invitedBy,
        invitedByName: null,
        createdAt: 0,
        acceptedAt: null,
        revoked: false,
      });
    },
    async revoke(id) {
      const row = rows.get(id);
      if (row) row.revoked = true;
    },
    async markAccepted(email) {
      const row = [...rows.values()].find((i) => i.email === email);
      if (row) row.acceptedAt = Date.now();
    },
  };
}

function fakeUserRepo(existing: UserSummary[] = []): UserRepository {
  return {
    async list() {
      return existing;
    },
    async findById(id) {
      return existing.find((u) => u.id === id) ?? null;
    },
    async findByEmail(email) {
      return existing.find((u) => u.email === email) ?? null;
    },
    async updateRoleAndBanned() {},
    async updateName() {},
    async deleteSessions() {},
    async deleteUser() {},
  };
}

describe("CreateInvitationUseCase", () => {
  it("不正な形式のメールアドレスは拒否する", async () => {
    const usecase = new CreateInvitationUseCase(fakeInvitationRepo(), fakeUserRepo());
    await expect(
      usecase.execute({ invitedBy: "admin-1", email: "not-an-email", role: "input_staff" }),
    ).rejects.toThrow("メールアドレスの形式が正しくありません");
  });

  it("既に登録済みの利用者のメールアドレスは拒否する", async () => {
    const users = fakeUserRepo([
      { id: "u1", name: "既存", email: "exists@example.co.jp", role: "input_staff", banned: false, createdAt: 0 },
    ]);
    const usecase = new CreateInvitationUseCase(fakeInvitationRepo(), users);
    await expect(
      usecase.execute({ invitedBy: "admin-1", email: "exists@example.co.jp", role: "admin" }),
    ).rejects.toThrow("既に利用者として登録されています");
  });

  it("正常な招待はリポジトリへ小文字化したメールアドレスで保存される", async () => {
    const invitations = fakeInvitationRepo();
    const usecase = new CreateInvitationUseCase(invitations, fakeUserRepo());
    await usecase.execute({ invitedBy: "admin-1", email: "New.User@Example.co.jp", role: "executive" });
    const saved = [...invitations.rows.values()][0];
    expect(saved?.email).toBe("new.user@example.co.jp");
    expect(saved?.role).toBe("executive");
  });
});

describe("RevokeInvitationUseCase", () => {
  it("招待を取消(revoked=true)にする", async () => {
    const invitations = fakeInvitationRepo();
    await invitations.upsert({ email: "a@example.co.jp", role: "input_staff", invitedBy: "admin-1" });
    const id = [...invitations.rows.keys()][0]!;
    const usecase = new RevokeInvitationUseCase(invitations);
    await usecase.execute(id);
    expect(invitations.rows.get(id)?.revoked).toBe(true);
  });
});

describe("ListInvitationsUseCase", () => {
  it("リポジトリの一覧をそのまま返す", async () => {
    const invitations = fakeInvitationRepo();
    await invitations.upsert({ email: "a@example.co.jp", role: "input_staff", invitedBy: "admin-1" });
    const usecase = new ListInvitationsUseCase(invitations);
    const result = await usecase.execute();
    expect(result).toHaveLength(1);
    expect(result[0]?.email).toBe("a@example.co.jp");
  });
});
