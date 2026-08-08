import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehicleMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { PageHead } from "../../../_components/PageHead";
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
      <VehicleMasterManager initialVehicles={vehicles} yearMonth={yearMonth} />
    </div>
  );
}
