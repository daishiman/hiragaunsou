import { describe, expect, it } from "vitest";
import type { UserRepository, UserSummary } from "../../src/domain/repositories/UserRepository";
import type { Role } from "../../src/domain/rules/permissions";
import {
  DeleteUserByAdminUseCase,
  UpdateOwnProfileUseCase,
  UpdateUserByAdminUseCase,
  isRole,
} from "../../src/usecase/steps/manageUsers";

function fakeRepo(initial: UserSummary[]): UserRepository & {
  rows: Map<string, UserSummary>;
  deletedSessionsFor: string[];
} {
  const rows = new Map(initial.map((u) => [u.id, u]));
  const deletedSessionsFor: string[] = [];
  return {
    rows,
    deletedSessionsFor,
    async list() {
      return [...rows.values()];
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByEmail(email) {
      return [...rows.values()].find((u) => u.email === email) ?? null;
    },
    async updateRoleAndBanned(id, input) {
      const row = rows.get(id);
      if (!row) return;
      if (input.role !== undefined) row.role = input.role;
      if (input.banned !== undefined) row.banned = input.banned;
    },
    async updateName(id, name) {
      const row = rows.get(id);
      if (row) row.name = name;
    },
    async deleteSessions(userId) {
      deletedSessionsFor.push(userId);
    },
    async deleteUser(id) {
      if (id === "has-history") {
        throw new Error("FOREIGN KEY constraint failed");
      }
      rows.delete(id);
    },
  };
}

const admin: UserSummary = {
  id: "admin-1",
  name: "管理者",
  email: "admin@example.co.jp",
  role: "admin",
  banned: false,
  createdAt: 0,
};
const staff: UserSummary = {
  id: "staff-1",
  name: "入力担当",
  email: "staff@example.co.jp",
  role: "input_staff",
  banned: false,
  createdAt: 1,
};

describe("isRole", () => {
  it("有効なロールのみtrueを返す", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("input_staff")).toBe(true);
    expect(isRole("executive")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe("UpdateUserByAdminUseCase", () => {
  it("自分自身を凍結しようとするとエラー", async () => {
    const repo = fakeRepo([admin]);
    const usecase = new UpdateUserByAdminUseCase(repo);
    await expect(
      usecase.execute({ actorId: "admin-1", targetUserId: "admin-1", banned: true }),
    ).rejects.toThrow("自分自身を凍結することはできません");
  });

  it("自分自身から管理者ロールを外そうとするとエラー", async () => {
    const repo = fakeRepo([admin]);
    const usecase = new UpdateUserByAdminUseCase(repo);
    await expect(
      usecase.execute({ actorId: "admin-1", targetUserId: "admin-1", role: "input_staff" as Role }),
    ).rejects.toThrow("自分自身から管理者ロールを外すことはできません");
  });

  it("他ユーザーの凍結は成功し、セッションを失効させる", async () => {
    const repo = fakeRepo([admin, staff]);
    const usecase = new UpdateUserByAdminUseCase(repo);
    await usecase.execute({ actorId: "admin-1", targetUserId: "staff-1", banned: true });
    expect(repo.rows.get("staff-1")?.banned).toBe(true);
    expect(repo.deletedSessionsFor).toContain("staff-1");
  });

  it("存在しないユーザーへの操作はエラー", async () => {
    const repo = fakeRepo([admin]);
    const usecase = new UpdateUserByAdminUseCase(repo);
    await expect(
      usecase.execute({ actorId: "admin-1", targetUserId: "missing", banned: true }),
    ).rejects.toThrow("対象のユーザーが見つかりません");
  });
});

describe("DeleteUserByAdminUseCase", () => {
  it("自分自身は削除できない", async () => {
    const repo = fakeRepo([admin]);
    const usecase = new DeleteUserByAdminUseCase(repo);
    await expect(usecase.execute({ actorId: "admin-1", targetUserId: "admin-1" })).rejects.toThrow(
      "自分自身を削除することはできません",
    );
  });

  it("存在しないユーザーはエラー", async () => {
    const repo = fakeRepo([admin]);
    const usecase = new DeleteUserByAdminUseCase(repo);
    await expect(usecase.execute({ actorId: "admin-1", targetUserId: "missing" })).rejects.toThrow(
      "対象のユーザーが見つかりません",
    );
  });

  it("履歴の無いユーザーは削除できる", async () => {
    const repo = fakeRepo([admin, staff]);
    const usecase = new DeleteUserByAdminUseCase(repo);
    await usecase.execute({ actorId: "admin-1", targetUserId: "staff-1" });
    expect(repo.rows.has("staff-1")).toBe(false);
  });

  it("操作履歴が残っているユーザーは分かりやすいエラーメッセージで拒否する", async () => {
    const historyUser: UserSummary = { ...staff, id: "has-history", email: "history@example.co.jp" };
    const repo = fakeRepo([admin, historyUser]);
    const usecase = new DeleteUserByAdminUseCase(repo);
    await expect(
      usecase.execute({ actorId: "admin-1", targetUserId: "has-history" }),
    ).rejects.toThrow("凍結");
  });
});

describe("UpdateOwnProfileUseCase", () => {
  it("空文字の氏名は拒否する", async () => {
    const repo = fakeRepo([staff]);
    const usecase = new UpdateOwnProfileUseCase(repo);
    await expect(usecase.execute("staff-1", "   ")).rejects.toThrow("氏名を入力してください");
  });

  it("100文字を超える氏名は拒否する", async () => {
    const repo = fakeRepo([staff]);
    const usecase = new UpdateOwnProfileUseCase(repo);
    await expect(usecase.execute("staff-1", "あ".repeat(101))).rejects.toThrow("氏名が長すぎます");
  });

  it("トリムして保存する", async () => {
    const repo = fakeRepo([staff]);
    const usecase = new UpdateOwnProfileUseCase(repo);
    await usecase.execute("staff-1", "  新しい名前  ");
    expect(repo.rows.get("staff-1")?.name).toBe("新しい名前");
  });
});
