import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { ImportDiffAlertPanel } from "../../_components/ImportDiffAlertPanel";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../src/infrastructure/db/D1ImportBatchRepository";
import { IMPORT_SOURCES } from "../../../src/domain/rules/importSources";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { isYearMonth } from "../../_lib/yearMonth";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
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

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const repo = new D1ImportBatchRepository(db);

  /*
    対象月の既定は他の画面と同じ「まだ締めていない、取込のある最も新しい月」にする。
    取込だけ前月・後続画面は当月という食い違いがあり、取り込んだ月と違う月の画面へ
    移ってしまうことが「反映されていない」の一因になっていた。
  */
  const yearMonth = isYearMonth(ym) ? ym : await resolveWorkingYearMonth(db);
  const imported = Object.fromEntries(
    await Promise.all(
      IMPORT_SOURCES.map(
        async (source) =>
          [source.sourceType, await repo.findBatches(yearMonth, source.sourceType)] as const,
      ),
    ),
  );

  return (
    <div>
      <ScreenHeader screen="/import" />
      {/*
        取り込んだ内容が前回と違うときだけ、ここに1行ずつ出る。
        違いが無ければ何も出ないので、ふだんの取込の邪魔にはならない。
      */}
      <ImportDiffAlertPanel className="mb-4" />
      <ImportForm
        key={yearMonth}
        yearMonth={yearMonth}
        imported={imported}
        initialWorkflowStep={step ?? null}
      />
    </div>
  );
}
