import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehicleMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { PageHead } from "../../../_components/PageHead";
import { VehicleMasterManager } from "./VehicleMasterManager";

/**
 * /admin/vehicle-master: 車両マスタ(保険・税・リース料)のCSV一括登録・更新画面 (manage_imports=admin専用)。
 * これまで車両マスタを新規登録する手段が無く、車両の入れ替え時に開発者がD1へ直接SQLを打っていた。
 * 収支計算の土台であるマスタを、管理者自身が社内Excelから書き出したCSVで更新できるようにする。
 */
export default async function AdminVehicleMasterPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "manage_imports")) redirect("/");

  const { env } = await getCloudflareContext({ async: true });
  const vehicles = await new D1VehicleMasterRepository(createDb(env.DB)).findAllActive();

  return (
    <div className="max-w-5xl">
      <PageHead
        kind="tool"
        title="車両マスタ管理"
        lead="車番ごとの保険・税・リース料をCSVで一括登録・更新します。ここを直すと以降の収支計算に反映されます。"
      />
      <VehicleMasterManager initialVehicles={vehicles} />
    </div>
  );
}
