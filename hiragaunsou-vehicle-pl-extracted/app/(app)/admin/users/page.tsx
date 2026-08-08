import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../../_components/AccessDenied";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1UserRepository } from "../../../../src/infrastructure/db/D1UserRepository";
import { D1InvitationRepository } from "../../../../src/infrastructure/db/D1InvitationRepository";
import { ListUsersUseCase } from "../../../../src/usecase/steps/manageUsers";
import { ListInvitationsUseCase } from "../../../../src/usecase/steps/manageInvitations";
import { PageHead } from "../../../_components/PageHead";
import { UsersManager } from "./UsersManager";

/**
 * /admin/users: 管理者による全ユーザー管理画面 (manage_users 権限のみ)。
 * 一覧はServer Componentで取得し、ロール変更・凍結操作はClient Componentへ委譲する。
 */
export default async function AdminUsersPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "manage_users")) {
    return <AccessDenied screenName="ユーザー管理" permission="manage_users" />;
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const users = await new ListUsersUseCase(new D1UserRepository(db)).execute();
  const invitations = await new ListInvitationsUseCase(new D1InvitationRepository(db)).execute();

  return (
    <div className="max-w-4xl">
      <PageHead
        kind="tool"
        title="ユーザー管理"
        lead="全ユーザーのロール変更・アカウント凍結(ログイン禁止)・新規ユーザーの招待を行います。"
      />
      <UsersManager
        initialUsers={users}
        initialInvitations={invitations}
        currentUserId={session.id}
      />
    </div>
  );
}
