import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../../_components/AccessDenied";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../../src/infrastructure/db/D1ImportBatchRepository";
import { D1AuditLogRepository } from "../../../../src/infrastructure/db/D1AuditLogRepository";
import { D1FileImportLogRepository } from "../../../../src/infrastructure/db/D1FileImportLogRepository";
import {
  ListImportBatchDeletionLogUseCase,
  ListImportBatchesUseCase,
} from "../../../../src/usecase/steps/manageImportBatches";
import { D1VehiclePlRepository } from "../../../../src/infrastructure/db/D1VehiclePlRepository";
import {
  ListMonthlyPlDeletionLogUseCase,
  ListMonthsWithoutImportsUseCase,
} from "../../../../src/usecase/steps/manageMonthlyPlData";
import { PageHead } from "../../../_components/PageHead";
import { ImportBatchesManager } from "./ImportBatchesManager";
import { EmptyMonthsManager } from "./EmptyMonthsManager";

/**
 * /admin/import-batches: 管理者による全期間・全帳票種別の取込バッチ管理画面 (manage_imports=admin専用)。
 * 「別の月のサンプルデータが誤って本番へ取り込まれた」といった事故を、開発者にSQLを打ってもらわず
 * 管理者自身が発見・削除できるようにする。
 */
export default async function AdminImportBatchesPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "manage_imports")) {
    return <AccessDenied screenName="取込データ管理" permission="manage_imports" />;
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const batches = await new ListImportBatchesUseCase(new D1ImportBatchRepository(db)).execute();
  const deletionLog = await new ListImportBatchDeletionLogUseCase(new D1AuditLogRepository(db)).execute();
  // 取り込んだファイルの記録 (マスタ取込も含む)。同じファイルを二重に取り込まないための照合に使う。
  const fileLog = await new D1FileImportLogRepository(db).listAll();
  // ファイルを1件も取り込んでいないのに収支表だけが残っている月。
  // 探す手間をこちらで引き受け、消すかどうかの判断は利用者に残す。
  const emptyMonths = await new ListMonthsWithoutImportsUseCase(
    new D1VehiclePlRepository(db),
    new D1ImportBatchRepository(db),
  ).execute();
  const emptyMonthsDeletionLog = await new ListMonthlyPlDeletionLogUseCase(
    new D1AuditLogRepository(db),
  ).execute();

  return (
    <div className="max-w-5xl">
      <PageHead
        kind="tool"
        title="取込データ管理"
        lead="全期間・全帳票種別の取込バッチを確認し、誤って取り込まれたデータを削除します。削除は取り消せません。"
      />
      <ImportBatchesManager
        initialBatches={batches}
        initialDeletionLog={deletionLog}
        initialFileLog={fileLog}
      />
      <EmptyMonthsManager
        initialMonths={emptyMonths}
        initialDeletionLog={emptyMonthsDeletionLog}
      />
    </div>
  );
}
