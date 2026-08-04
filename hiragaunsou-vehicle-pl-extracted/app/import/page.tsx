import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../src/infrastructure/auth/session";
import { checkAccess } from "../../src/infrastructure/auth/accessControl";
import { createDb } from "../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../src/infrastructure/db/D1ImportBatchRepository";
import { IMPORT_SOURCES } from "../../src/domain/rules/importSources";
import { defaultImportYearMonth, isYearMonth } from "../_lib/yearMonth";
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
        async (source) => [source.sourceType, await repo.findBatches(yearMonth, source.sourceType)] as const,
      ),
    ),
  );

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-ink">月次データ取込</h1>
        <p className="mt-1 text-sm text-ink-muted">
          業務フローのSTEP順に元データを取り込みます。傭車(車番88888)は自動で除外されます。
        </p>
      </header>
      <ImportForm yearMonth={yearMonth} imported={imported} />
    </main>
  );
}
