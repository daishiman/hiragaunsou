import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehicleMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { PageHead } from "../../../_components/PageHead";
import { SourceDataNote } from "../../../_components/SourceDataNote";
import { defaultImportYearMonth, isYearMonth } from "../../../_lib/yearMonth";
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
  if (!checkAccess(session, "manage_imports")) redirect("/");

  const { env } = await getCloudflareContext({ async: true });
  const vehicles = await new D1VehicleMasterRepository(createDb(env.DB)).findAllActive();

  // けん引先を変えると収支表を作り直すため、どの月の表を直すのかが要る。
  const ym = (await searchParams).ym;
  const yearMonth = isYearMonth(ym) ? ym : defaultImportYearMonth();

  return (
    <div className="max-w-5xl">
      <PageHead
        kind="tool"
        title="車両マスタ管理"
        lead="車番・車種・保険・税・リース料の登録先です。ここが空の車両は、収支表で固定費が0のまま並びます。車両の入れ替えがあった月に更新してください。"
      />
      <div className="mb-6">
        <SourceDataNote sourceFile="★車両別収支計算用2026年5月.xlsx">
          <p>
            収支表シート(「5月収支表」など)にある「車番」「車種名」「所属」「自賠責」「任意保険」「自動車税」「重量税」「車両リース費」「割賦費」の9列が元データです。
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
      </div>
      <VehicleMasterManager initialVehicles={vehicles} yearMonth={yearMonth} />
    </div>
  );
}
