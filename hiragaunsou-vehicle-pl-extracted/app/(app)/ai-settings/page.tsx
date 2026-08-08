import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1AiProviderCredentialRepository } from "../../../src/infrastructure/db/D1AiProviderCredentialRepository";
import { ListAiProviderCredentialsUseCase } from "../../../src/usecase/steps/manageAiProviderCredentials";
import { PageHead } from "../../_components/PageHead";
import { AiSettingsManager } from "./AiSettingsManager";

/**
 * /ai-settings: AI連携APIキー管理画面 (admin専用)。
 * 一覧はServer Componentでマスク値のみ取得し、フォーム操作はClient Componentへ委譲する
 * (平文APIキーは一度もServer Component→Client Componentの受け渡しに乗らない)。
 */
export default async function AiSettingsPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "manage_api_keys")) {
    return <AccessDenied screenName="AI設定" permission="manage_api_keys" />;
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const credentials = await new ListAiProviderCredentialsUseCase(
    new D1AiProviderCredentialRepository(db),
  ).execute();

  return (
    <div className="max-w-3xl">
      <PageHead
        kind="tool"
        title="AI設定"
        lead="AI要因分析などに使う外部AIプロバイダのAPIキーを管理します。キーは暗号化して保存し、この画面の管理者だけが登録・削除できます。"
      />
      <AiSettingsManager initialCredentials={credentials} />
    </div>
  );
}
