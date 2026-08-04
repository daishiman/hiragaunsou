import { redirect } from "next/navigation";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { PageHead } from "../../_components/PageHead";
import { ImportForm } from "./ImportForm";

/** F3/F4/F5 月次データ取込 (S4画面)。3種のCSVをアップロードし、その場で件数を表示する。 */
export default async function ImportPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "input")) redirect("/");

  return (
    <div className="max-w-2xl">
      <PageHead
        kind="ops"
        title="月次データ取込"
        lead="運行実績・売上・給与のCSVをアップロードすると自動でパースされます(傭車は自動除外)。"
      />
      <ImportForm />
    </div>
  );
}
