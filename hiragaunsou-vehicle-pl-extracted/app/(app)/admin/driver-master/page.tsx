import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import {
  D1DriverMasterRepository,
  D1VehicleMasterRepository,
} from "../../../../src/infrastructure/db/D1MasterRepository";
import { AccessDenied } from "../../../_components/AccessDenied";
import { ScreenHeader } from "../../../_components/ScreenHeader";
import { SourceDataNote } from "../../../_components/SourceDataNote";
import { isYearMonth } from "../../../_lib/yearMonth";
import { resolveWorkingYearMonth } from "../../../_lib/workingYearMonth";
import { DriverMasterManager } from "./DriverMasterManager";

/**
 * /admin/driver-master: 運転者マスタ(社員No ↔ 車番)の管理画面 (manage_imports=admin専用)。
 *
 * 給与集計表は社員No単位、収支表は車番単位で、両者を結ぶ表はここにしかない。
 * 未整備のまま運用すると、給与CSVを正しく取り込んでも収支表の人件費が全車両0になり、
 * 月次収支表では「稼働しているのに給与が0です」として並ぶことになる。
 */
export default async function AdminDriverMasterPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "manage_imports")) {
    return <AccessDenied screenName="運転者マスタ管理" permission="manage_imports" />;
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const [drivers, vehicles] = await Promise.all([
    new D1DriverMasterRepository(db).findAll(),
    new D1VehicleMasterRepository(db).findAllActive(),
  ]);

  // 社内Excelが年度ブック(12か月分のシート)のとき、どの月のシートを読むかの手掛かり。
  // 車両マスタ管理と同じ既定にしないと、同じExcelを選んだのに画面ごとに違う月を読む。
  const ym = (await searchParams).ym;
  const yearMonth = isYearMonth(ym) ? ym : await resolveWorkingYearMonth(db);

  return (
    <div>
      <ScreenHeader
        screen="/admin/driver-master"
        help={
          <SourceDataNote sourceFile="★車両別収支計算用2026年5月.xlsx">
            <p>
              ここが空だと、給与を取り込んでも収支表の人件費は0のままになります。
              人事異動があった月に更新してください。
            </p>
            <p>
            収支表シート(「5月収支表」など)にある「コード」(社員No)・「運転者名」・「車番」の3列が元データです。
            この3列があるExcelなら、ファイル名が違っても・シート名が違っても読み取れます。
            車両マスタと同じファイルを、同じ手順で選べます。
          </p>
          <p>
            <strong className="text-ink">
              社員Noと車番の対応が書かれているのは、社内でもこのExcelだけです。
            </strong>
            給与集計表(日給者)のCSVには車番の列がなく、売上モニタリストの車番は伝票ごとの実績なので
            (お1人が日によって別の車に乗っています)、どちらからも「この方の車はこれ」を決められません。
            収支表シートで人が決めた割り当てが唯一の正です。
          </p>
          <p>
            1台に2人乗務している行(「658/720」のように2人分書かれている行)は、1人ずつに分けて登録します。
            傭車・諸口の行は自社の運転者ではないので読み飛ばします。
          </p>
          <p>
            この対応表は月ごとの実績ではなく人事の状態なので、どの月のシートから読んでも同じ結果になります。
            以前のように社員No・氏名・車番の3列をCSVに書き出して取り込むこともできます。
          </p>
          </SourceDataNote>
        }
      />
      <DriverMasterManager
        initialDrivers={drivers}
        vehicleNos={vehicles.map((v) => v.vehicleNo)}
        yearMonth={yearMonth}
      />
    </div>
  );
}
