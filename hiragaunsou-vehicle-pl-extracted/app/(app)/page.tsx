import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../src/infrastructure/auth/session";
import { createDb } from "../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../src/infrastructure/db/D1ImportBatchRepository";
import { D1ManualInputRepository } from "../../src/infrastructure/db/D1ManualInputRepository";
import { D1ReviewFlagRepository } from "../../src/infrastructure/db/D1ReviewFlagRepository";
import { D1VehiclePlRepository } from "../../src/infrastructure/db/D1VehiclePlRepository";
import { D1CleansingDecisionRepository } from "../../src/infrastructure/db/D1CleansingDecisionRepository";
import { GetWorkflowProgressUseCase } from "../../src/usecase/steps/getWorkflowProgress";
import { currentYearMonth } from "../_lib/yearMonth";
import { yearMonthLabel } from "../_lib/format";
import { PageHead } from "../_components/PageHead";
import { WorkflowStepCard } from "../_components/WorkflowStepCard";

/**
 * ホーム = 業務フロー(docx 8ステップ)の進行画面。
 *
 * 機能一覧ではなく「いまどこまで終わっていて、次に何をすればいいか」だけを出す。
 * 上から順に進めれば月次の締めが終わる、という1本道にすることで、
 * 手順書を見ながら画面を探す状態をなくす(機能一覧の役割はサイドバーが担う)。
 */
export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const yearMonth = currentYearMonth();
  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);

  const progress = await new GetWorkflowProgressUseCase(
    new D1ImportBatchRepository(db),
    new D1ManualInputRepository(db),
    new D1VehiclePlRepository(db),
    new D1ReviewFlagRepository(db),
    new D1CleansingDecisionRepository(db),
  ).execute(yearMonth);

  const next = progress.nextStep;
  const donePct = Math.round((progress.doneCount / progress.totalCount) * 100);

  return (
    <>
      <PageHead
        kind="ops"
        title={`${yearMonthLabel(yearMonth)}度の締め`}
        lead={`${session.name}さん(${session.role})— 上から順に進めれば締めが終わります。`}
      />

      {/* 現在地: 次にやること1つだけを大きく出す */}
      <section className="rounded-xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-ink-muted">次にやること</p>
          <p className="num text-xs text-ink-muted">
            {progress.doneCount} / {progress.totalCount} ステップ完了
          </p>
        </div>

        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
          <div
            className="h-full rounded-full bg-brand transition-all duration-300"
            style={{ width: `${donePct}%` }}
          />
        </div>

        {next ? (
          <div className="mt-4">
            <p className="text-lg font-bold text-ink">
              STEP {next.step.id}　{next.step.title}
            </p>
            <p className="mt-1 text-sm text-ink-muted">{next.step.summary}</p>
            <p className="num mt-2 text-xs text-ink-muted">{next.detail}</p>
            <Link
              href={next.step.href}
              className="pressable mt-4 inline-block rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
            >
              STEP {next.step.id} を開く
            </Link>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-lg font-bold text-ink">今月の締めは完了しています</p>
            <p className="mt-1 text-sm text-ink-muted">
              月次収支表・年間集計は最新の状態です。転記作業は不要です。
            </p>
            <Link
              href="/grid"
              className="pressable mt-4 inline-block rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand-deep hover:bg-brand-soft"
            >
              月次収支表を見る
            </Link>
          </div>
        )}
      </section>

      {/* 全体の手順。残りが何ステップあるか常に見えるようにする */}
      <section className="mt-5">
        <h2 className="text-sm font-bold text-ink">作成手順(全8ステップ)</h2>
        <ol className="mt-3 grid gap-2">
          {progress.steps.map((s) => (
            <li key={s.step.id}>
              <WorkflowStepCard
                progress={s}
                isNext={next?.step.id === s.step.id}
              />
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-5 rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">締めのあとに見るもの</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/grid", label: "月次収支表", desc: "車両別の内訳を確認する" },
            { href: "/annual", label: "年間集計・対前年", desc: "12ヶ月の推移と前年比" },
            { href: "/deficit", label: "赤字の理由", desc: "赤字車両を3分類で見る" },
            { href: "/report", label: "AI要因分析レポート", desc: "損益変動の要因を要約" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="pressable rounded-lg border border-line px-4 py-3 hover:bg-subtle"
            >
              <p className="text-sm font-semibold text-ink">{l.label}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{l.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
