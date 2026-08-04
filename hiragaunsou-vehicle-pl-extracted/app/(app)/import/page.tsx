import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
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
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "input")) redirect("/");

  const { ym } = await searchParams;
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
        lead="業務フローのSTEP順に元データを取り込みます。傭車(車番88888)は自動で除外されます。"
      />
      <ImportForm yearMonth={yearMonth} imported={imported} />
    </div>
  );
}
