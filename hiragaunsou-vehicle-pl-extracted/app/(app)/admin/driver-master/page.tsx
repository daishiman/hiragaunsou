import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1DriverMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { PageHead } from "../../../_components/PageHead";
import { DriverMasterManager } from "./DriverMasterManager";

/**
 * /admin/driver-master: 運転者マスタ(社員No ↔ 車番)の管理画面 (manage_imports=admin専用)。
 *
 * 給与集計表は社員No単位、収支表は車番単位で、両者を結ぶ表はここにしかない。
 * 未整備のまま運用すると、給与CSVを正しく取り込んでも収支表の人件費が全車両0になり、
 * 月次収支表では「稼働しているのに給与が0です」として並ぶことになる。
 */
export default async function AdminDriverMasterPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "manage_imports")) redirect("/");

  const { env } = await getCloudflareContext({ async: true });
  const drivers = await new D1DriverMasterRepository(createDb(env.DB)).findAll();

  return (
    <div className="max-w-5xl">
      <PageHead
        kind="tool"
        title="運転者マスタ管理"
        lead="社員Noと車番の対応表です。ここが空だと、給与を取り込んでも収支表の人件費は0のままになります。人事異動があった月に更新してください。"
      />
      <DriverMasterManager initialDrivers={drivers} />
    </div>
  );
}
