import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehicleMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { AccessDenied } from "../../../_components/AccessDenied";
import { PageHead } from "../../../_components/PageHead";
import { SourceDataNote } from "../../../_components/SourceDataNote";
import { isYearMonth } from "../../../_lib/yearMonth";
import { resolveWorkingYearMonth } from "../../../_lib/workingYearMonth";
import { VehicleMasterManager } from "./VehicleMasterManager";

/**
 * /admin/vehicle-master: 車両マスタ(車番・車種・保険・税・リース料)の登録画面 (manage_imports=admin専用)。
 *
 * 収支表の固定費(保険料計・賦課税計・運送費計)はすべてここから入る。
 * かつては完成済み収支表(Excel)の取込がこのマスタを自動更新していたが、
 * それだとCSVの紐付けが通っていなくても表が完成してしまうため取りやめた。
 * 車両の登録経路はこの画面のCSV取込だけになっている。
 */
export default async function AdminVehicleMasterPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "manage_imports")) {
    return <AccessDenied screenName="車両マスタ管理" permission="manage_imports" />;
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const vehicles = await new D1VehicleMasterRepository(db).findAllActive();

  // けん引先を変えると収支表を作り直すため、どの月の表を直すのかが要る。
  // 既定は他画面と同じ「いま作業している月」。当月を既定にすると、5月を締めている最中の変更が
  // 誰も見ていない月の収支表に反映されてしまう。
  const ym = (await searchParams).ym;
  const yearMonth = isYearMonth(ym) ? ym : await resolveWorkingYearMonth(db);

  return (
    <div className="max-w-5xl">
      <PageHead
        kind="tool"
        title="車両マスタ管理"
        lead="車番・車種・保険・税・リース料の登録先です。"
        help={
          <SourceDataNote sourceFile="★車両別収支計算用2026年5月.xlsx">
            <p>
              ここが空の車両は、収支表で固定費が0のまま並びます。
              車両の入れ替えがあった月に更新してください。
            </p>
            <p>
              収支表シート(「5月収支表」など)にある「車番」「車種名」「所属」「自賠責」「任意保険」「自動車税」「重量税」「車両リース費」「割賦費」の9列が元データです。
              この9列があるExcelなら、ファイル名が違っても・シート名が違っても読み取れます。
              運転者マスタと同じファイルを、同じ手順で選べます。
            </p>
            <p>
              車種名から原価区分(修繕費・タイヤ費の標準単価)を自動で判定し、
              Excelの行の並び(トラクタの直下に被けん引車)からけん引の組も復元します。
            </p>
            <p>
              保険・税・リース料は月ごとの実績ではなく車両ごとの決まった金額なので、
              どの月のシートから読んでも同じ値になります。以前のように9列をCSVに書き出して取り込むこともできます。
            </p>
          </SourceDataNote>
        }
      />
      <VehicleMasterManager initialVehicles={vehicles} yearMonth={yearMonth} />
    </div>
  );
}
