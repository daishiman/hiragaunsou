import { redirect } from "next/navigation";
import { getServerSession } from "../../src/infrastructure/auth/session";
import { checkAccess } from "../../src/infrastructure/auth/accessControl";
import { ImportForm } from "./ImportForm";

/** F3/F4/F5 データ取込 (S4画面)。3種のCSVをアップロードし、その場で件数を表示する。 */
export default async function ImportPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "input")) redirect("/");

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-ink">データ取込</h1>
        <p className="mt-1 text-sm text-ink-muted">
          運行実績・売上・給与のCSVをアップロードすると自動でパースされます(傭車は自動除外)。
        </p>
      </header>
      <ImportForm />
    </main>
  );
}
