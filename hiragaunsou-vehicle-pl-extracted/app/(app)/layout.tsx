import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../src/infrastructure/auth/session";
import { createDb } from "../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ReviewFlagRepository } from "../../src/infrastructure/db/D1ReviewFlagRepository";
import { AppShell } from "../_components/AppShell";
import { currentYearMonth } from "../_lib/yearMonth";

/**
 * 認証済み画面の共通レイアウト。
 * ここでサイドバー・トップバー・フッターを1箇所に集約し、全ページで同じ骨格になるようにする
 * (ログイン画面 /sign-in と API は このルートグループの外に置くのでシェルを被らない)。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const yearMonth = currentYearMonth();
  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);

  const [registration, anomalyFlags] = await Promise.all([
    new D1VehiclePlRepository(db).countByYearMonth(yearMonth),
    new D1ReviewFlagRepository(db).findOpenByYearMonth(yearMonth),
  ]);

  return (
    <AppShell
      userName={session.name}
      userRole={session.role}
      role={session.role}
      yearMonth={yearMonth}
      badges={{
        registration,
        anomaly: anomalyFlags.filter((f) => f.status === "open").length,
      }}
    >
      {children}
    </AppShell>
  );
}
