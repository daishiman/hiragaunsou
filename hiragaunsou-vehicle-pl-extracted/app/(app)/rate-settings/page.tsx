import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1RateMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";
import { PageHead } from "../../_components/PageHead";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { RateSettingsManager } from "./RateSettingsManager";

/**
 * /rate-settings: 率マスタ管理画面 (マスタ編集権限)。
 *
 * 一般管理費率・組合割引率・賞与年額といった「全車両に効く値」の設定場所。
 * これまでこの画面が無く、率を変えるにはマイグレーションを書くしかなかったため、
 * コード上の既定値・Excelの実運用値・画面の説明文がそれぞれ別の率を指す状態になっていた。
 */
export default async function RateSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "edit_master")) redirect("/");

  const { ym } = await searchParams;
  const yearMonth = ym || currentYearMonth();

  const { env } = await getCloudflareContext({ async: true });
  const repo = new D1RateMasterRepository(createDb(env.DB));
  const [entries, rates, thresholds] = await Promise.all([
    repo.listRates(),
    repo.getRates(yearMonth),
    repo.getDeficitThresholds(yearMonth),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHead
        kind="tool"
        title="率マスタ設定"
        lead="一般管理費率や組合割引率など、収支表の計算に使う率・単価を設定します。保存すると対象月の収支表を作り直します。"
      />
      <div className="mb-4">
        <YearMonthSelect
          basePath="/rate-settings"
          value={yearMonth}
          options={selectableYearMonths(13)}
        />
      </div>
      <RateSettingsManager
        yearMonth={yearMonth}
        initialEntries={entries}
        resolved={{ ...rates, ...thresholds }}
      />
    </div>
  );
}
