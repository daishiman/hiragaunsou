import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { createDb } from "../../../src/infrastructure/db/client";
import { account } from "../../../src/infrastructure/db/auth-schema";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { ProfileForm } from "./ProfileForm";

const ROLE_LABELS: Record<string, string> = {
  admin: "管理者",
  input_staff: "入力担当",
  executive: "経営層",
};

/**
 * /profile: 自分のプロフィール確認・編集画面。
 * ロール・メールアドレスは本人からは変更できない(閲覧のみ)。ログアウト導線もここに置く。
 */
export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  // パスワード変更UIは、メール/パスワード招待(authMethod="password")でパスワードを設定済みの
  // ユーザーにのみ表示する(Googleサインインのみのユーザーにはパスワードという概念が無いため)。
  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const credentialRows = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, session.id), eq(account.providerId, "credential")))
    .limit(1);
  const hasPasswordCredential = credentialRows.length > 0;

  return (
    <div>
      <ScreenHeader screen="/profile" />
      <ProfileForm
        userId={session.id}
        name={session.name}
        email={session.email}
        roleLabel={ROLE_LABELS[session.role] ?? session.role}
        hasPasswordCredential={hasPasswordCredential}
      />
    </div>
  );
}
