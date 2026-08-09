import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { AccessDenied } from "../../_components/AccessDenied";
import { ImportDiffAlertPanel } from "../../_components/ImportDiffAlertPanel";
import { PageHead } from "../../_components/PageHead";
import { SourceDataNote } from "../../_components/SourceDataNote";
import { masterChangeStack } from "../../_lib/masterChangeStack";
import { MasterChangeManager } from "./MasterChangeManager";
import type { MasterChangeStatus } from "../../../src/usecase/steps/applyMasterChange";

/**
 * /master-changes: マスタを直したあとの反映を扱う画面。
 *
 * まだ締めていない月は直した時点で反映されるので、ここは触らなくてよい。
 * 締めた月だけが「据え置き」になり、反映するかどうかをここで人が決める。
 */
export default async function MasterChangesPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "manage_imports")) {
    return <AccessDenied screenName="マスタの直しの反映" permission="manage_imports" />;
  }

  // 締めた月ぶんの作り直し計算を回すので軽くはない。画面を開いたときに1回だけ数える。
  let status: MasterChangeStatus | null = null;
  let loadError: string | null = null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    const stack = masterChangeStack(createDb(env.DB), {
      id: session.id,
      name: session.name ?? "",
    });
    status = await stack.status.execute();
  } catch (e) {
    loadError = e instanceof Error ? e.message : "食い違いの確認に失敗しました";
  }

  return (
    <div className="max-w-4xl">
      <PageHead
        kind="tool"
        title="直した内容の反映"
        lead="締めた月とマスタが食い違っていないかを確認します。"
        help={
          <SourceDataNote>
            <p>
              率・車両・運転者のマスタを直すと、
              <strong>まだ締めていない月にはその場で反映</strong>されます。
              <strong>締めた月はそのまま据え置き</strong>ます。配布済みの収支表の数字が
              知らないうちに変わらないようにするためです。
            </p>
            <p>
              据え置いた月がいまのマスタと違っているときだけ、この画面に並びます。
              内容を見て納得できたら「反映する」を押してください。押したあとでも
              「取り消す」で1つ前の状態に戻せます。
            </p>
            <p>
              マスタそのものを直すのは
              <Link href="/rate-settings" className="underline">
                率マスタ設定
              </Link>
              ・
              <Link href="/admin/vehicle-master" className="underline">
                車両マスタ管理
              </Link>
              ・
              <Link href="/admin/driver-master" className="underline">
                運転者マスタ管理
              </Link>
              です。
            </p>
          </SourceDataNote>
        }
      />
      <ImportDiffAlertPanel className="mb-4" />
      <MasterChangeManager status={status} loadError={loadError} />
    </div>
  );
}
