import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehicleMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { PageHead } from "../../../_components/PageHead";
import { VehicleMasterManager } from "./VehicleMasterManager";

/**
 * /admin/vehicle-master: 車両マスタ(保険・税・リース料)の手動補正画面 (manage_imports=admin専用)。
 *
 * 通常運用では STEP7-8 の完成済み収支表(Excel)取込時に車両マスタが自動更新されるため、
 * この画面は自動更新で拾えなかった車両の補正や、収支表取込前に先行して登録したい場合に使う。
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
        lead="通常は毎月のデータ取込(STEP7-8の収支表Excel)から自動更新されます。個別修正が必要な場合のみ、ここでCSVを使ってください。"
      />
      <VehicleMasterManager initialVehicles={vehicles} />
    </div>
  );
}
