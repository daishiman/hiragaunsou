import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../src/infrastructure/auth/session";
import { createDb } from "../src/infrastructure/db/client";
import { D1ReviewFlagRepository } from "../src/infrastructure/db/D1ReviewFlagRepository";
import { GetTodoBoardUseCase } from "../src/usecase/steps/getTodoBoard";
import { currentYearMonth } from "./_lib/yearMonth";

const NAV_LINKS = [
  { href: "/todo", label: "ToDoボード", desc: "未入力・要確認カードを2択で捌く" },
  { href: "/import", label: "データ取込", desc: "運行実績・売上・給与ファイルを取込む" },
  { href: "/grid", label: "月次収支グリッド", desc: "車両×科目の収支表を確認する" },
  { href: "/manual-entry", label: "手入力", desc: "修理費実費・給油明細などを入力する" },
  { href: "/report", label: "AI要因分析レポート", desc: "損益変動の要因をAIが要約する" },
  { href: "/usage", label: "利用状況", desc: "AI利用の概算費用を確認する" },
];

/** S1 ホーム画面。ログイン必須。要対応(ToDo件数)→次のアクション→最近の順で見せる。 */
export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const yearMonth = currentYearMonth();
  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const todoUseCase = new GetTodoBoardUseCase(new D1ReviewFlagRepository(db));
  const todo = await todoUseCase.execute(yearMonth);

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-bold text-ink">車両別収支表</h1>
        <p className="mt-1 text-sm text-ink-muted">
          平賀運送 — 月次車両別P&amp;L自動化 / {session.name}さん({session.role})
        </p>
      </header>

      <section className="rounded-xl border border-line bg-white p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">
            {yearMonth} の要対応
          </h2>
          <Link href="/todo" className="text-xs font-semibold text-brand-deep hover:underline">
            ToDoボードを開く
          </Link>
        </div>
        {todo.totalOpen === 0 ? (
          <p className="text-sm text-ink-muted">今月の入力は完了しています。</p>
        ) : (
          <p className="text-sm text-ink">
            対応が必要なカードが <span className="num text-2xl font-bold text-accent">{todo.totalOpen}</span> 件あります。
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-bold text-ink">次のアクション</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="pressable rounded-xl border border-line bg-white p-4 hover:bg-subtle"
            >
              <p className="text-sm font-bold text-ink">{link.label}</p>
              <p className="mt-1 text-xs text-ink-muted">{link.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
