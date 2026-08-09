import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1RateMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import { selectableYearMonths } from "../../_lib/yearMonth";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { AccessDenied } from "../../_components/AccessDenied";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { SourceDataNote } from "../../_components/SourceDataNote";
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
  /*
    率・単価は1つ書き換えるだけで全車両・全月の収支表が動く。入力担当が毎月触る値ではないため、
    依頼者の判断で管理者だけが開ける画面にした(権限は manage_imports = 管理者のみ を借りる)。
    黙ってホームへ戻さず、開けない理由と誰に頼めばよいかを出す。
  */
  if (!checkAccess(session, "manage_imports")) {
    return <AccessDenied screenName="率マスタ設定" permission="manage_imports" />;
  }

  const { ym } = await searchParams;

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  // 率は月ごとに持つ値なので、既定の対象月は他画面と同じ「いま作業している月」に揃える。
  // 当月を既定にすると、5月を締めている最中に開いた率が5月の計算に効かず、直したのに変わらないように見える。
  const yearMonth = ym || (await resolveWorkingYearMonth(db));
  const repo = new D1RateMasterRepository(db);
  const [entries, rates, thresholds] = await Promise.all([
    repo.listRates(),
    repo.getRates(yearMonth),
    repo.getDeficitThresholds(yearMonth),
  ]);

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        screen="/rate-settings"
        help={
          <SourceDataNote>
            <p>
              一般管理費率や組合割引率など、収支表の計算に使う率・単価を設定します。
              保存すると対象月の収支表を作り直します。
            </p>
            <p>
              この画面の率・単価だけは、ファイルの取込ではなくここでの手入力で決まります。
              社内Excel「★車両別収支計算用」の計算式に埋め込まれている率にあたるもので、
              改定があったときにここを書き換えます(保存すると対象月の収支表を作り直します)。
            </p>
            <p>
              車番・保険・税は
              <Link href="/admin/vehicle-master" className="underline">
                車両マスタ管理
              </Link>
              、社員Noと車番の対応は
              <Link href="/admin/driver-master" className="underline">
                運転者マスタ管理
              </Link>
              で、同じ社内Excel(名前の例:「★車両別収支計算用2026年5月.xlsx」)から取り込みます。
            </p>
            <p>
              どの数字がどのファイルから来るかの全体像は
              <Link href="/logic" className="underline">
                データ設計・自動化方針
              </Link>
              にまとめています。
            </p>
          </SourceDataNote>
        }
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
