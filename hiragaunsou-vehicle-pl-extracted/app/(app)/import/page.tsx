import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";
import { IMPORT_SOURCES } from "../../../src/domain/rules/importSources";
import { PageHead } from "../../_components/PageHead";
import { defaultImportYearMonth, isYearMonth } from "../../_lib/yearMonth";
import { ImportForm } from "./ImportForm";

/**
 * 月次データ取込 (S4画面)。
 * 『車両別収支表 作成業務フロー』のSTEPごとに投入口を並べ、その月に何が済んで
 * 何が残っているかを一覧で示す。取込状況はサーバー側で読み、取込後は router.refresh() で更新する。
 */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; step?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "input")) {
    return <AccessDenied screenName="データ取込" permission="input" />;
  }

  const { ym, step } = await searchParams;
  const yearMonth = isYearMonth(ym) ? ym : defaultImportYearMonth();

  const { env } = await getCloudflareContext({ async: true });
  const repo = new D1ImportBatchRepository(createDb(env.DB));
  const imported = Object.fromEntries(
    await Promise.all(
      IMPORT_SOURCES.map(
        async (source) =>
          [source.sourceType, await repo.findBatches(yearMonth, source.sourceType)] as const,
      ),
    ),
  );

  return (
    <div className="max-w-3xl">
      <PageHead
        kind="ops"
        title="月次データ取込"
        lead="業務フローのSTEP順に元データを取り込みます"
        showHomeLink
      />
      <ImportForm
        key={yearMonth}
        yearMonth={yearMonth}
        imported={imported}
        initialWorkflowStep={step ?? null}
      />
    </div>
  );
}
