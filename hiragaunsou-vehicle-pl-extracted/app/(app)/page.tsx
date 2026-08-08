import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../src/infrastructure/auth/session";
import { checkAccess } from "../../src/infrastructure/auth/accessControl";
import { createDb } from "../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../src/infrastructure/db/D1ImportBatchRepository";
import { D1ManualInputRepository } from "../../src/infrastructure/db/D1ManualInputRepository";
import { D1ReviewFlagRepository } from "../../src/infrastructure/db/D1ReviewFlagRepository";
import { D1VehiclePlRepository } from "../../src/infrastructure/db/D1VehiclePlRepository";
import { D1CleansingDecisionRepository } from "../../src/infrastructure/db/D1CleansingDecisionRepository";
import { D1RateMasterRepository, RATE_KEYS } from "../../src/infrastructure/db/D1MasterRepository";
import { D1AnnualReferenceRepository } from "../../src/infrastructure/db/D1AnnualReferenceRepository";
import { GetWorkflowProgressUseCase } from "../../src/usecase/steps/getWorkflowProgress";
import { GetPeriodOverviewUseCase } from "../../src/usecase/steps/getPeriodOverview";
import { currentYearMonth, defaultImportYearMonth } from "../_lib/yearMonth";
import { yearMonthLabel, man, num, kmPriceLabel, pct } from "../_lib/format";
import { withYm } from "../_lib/withYm";
import { PageHead } from "../_components/PageHead";
import { WorkflowStepCard } from "../_components/WorkflowStepCard";
import { EmptyState } from "../_components/EmptyState";
import { StatTile } from "../_components/StatTile";
import { Disclosure } from "../_components/Disclosure";

/**
 * ホーム。
 *
 * 見る人にとって主目的は「儲かっているか(分析)」であり、入力作業はそれを支える手段でしかない。
 * そのため画面の最上段は直近で締めた月の経営サマリ(ダッシュボードの要約)とし、
 * その下に「次にやること」という入力作業の進行案内を続ける2段構成にしている。
 */
export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const yearMonth = currentYearMonth();
  const overviewYearMonth = defaultImportYearMonth();
  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);

  const canViewAnalysis = checkAccess(session, "view");

  const [progress, overview] = await Promise.all([
    new GetWorkflowProgressUseCase(
      new D1ImportBatchRepository(db),
      new D1ManualInputRepository(db),
      new D1VehiclePlRepository(db),
      new D1ReviewFlagRepository(db),
      new D1CleansingDecisionRepository(db),
      // キリンの協力金は rate_master に入る。手入力画面で入力済みかどうかはここを見る。
      async (ym) => {
        const rateMasterRepo = new D1RateMasterRepository(db);
        const [transport, management] = await Promise.all([
          rateMasterRepo.getRate(RATE_KEYS.kirinTransportSupport, ym, 0),
          rateMasterRepo.getRate(RATE_KEYS.kirinManagementSupport, ym, 0),
        ]);
        return transport + management;
      },
    ).execute(yearMonth),
    canViewAnalysis
      ? new GetPeriodOverviewUseCase(
          new D1VehiclePlRepository(db),
          new D1RateMasterRepository(db),
          new D1AnnualReferenceRepository(db),
        ).execute(overviewYearMonth, overviewYearMonth)
      : null,
  ]);

  const next = progress.nextStep;
  const donePct = Math.round((progress.doneCount / progress.totalCount) * 100);

  return (
    <>
      {/* 氏名・権限はサイドバー下部に常時出ているので、ここで繰り返さない */}
      <PageHead kind="analysis" title="ホーム" lead="儲かっているかの確認と、今月の入力作業をここから" />

      {/*
        主役: 直近で締めた月の経営サマリ。「儲かっているか」に画面を開いた瞬間に答える。
        詳しい推移・内訳・赤字理由は個別ページに任せ、ここでは4つの数字だけに絞る。
        ヘッダー右上の年月表示は「今月(入力作業の対象月)」を指すため、締め済みの直近月を
        扱うこのセクションだけは見出しで対象月を明示し、ヘッダー表示とのズレで
        誤解が生まれないようにする。
      */}
      {canViewAnalysis && overview ? (
        overview.isEmpty ? (
          <EmptyState
            title="まだ確定した収支データがありません"
            description="月次の締めが終わると、ここに経営サマリが表示されます。"
            actionHref="/import"
            actionLabel="データ取込へ"
          />
        ) : (
          <section>
            <p className="text-xs font-semibold text-ink-muted">{overview.label}度 経営サマリ(締め済み直近月)</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                hero
                label={`${overview.label} 期間損益`}
                value={man(overview.totals.profit)}
                negative={overview.totals.profit < 0}
                diff={overview.profitDiffRatio}
                diff2={overview.profitMomDiffRatio}
                sub={`利益率 ${pct(overview.margin)}`}
              />
              <StatTile
                label="売上"
                value={man(overview.totals.sales)}
                diff={overview.salesDiffRatio}
                diff2={overview.salesMomDiffRatio}
              />
              <StatTile
                label="赤字車両"
                value={num(overview.deficitCount)}
                unit={`/ ${num(overview.vehicleCount)}台`}
                negative={overview.deficitCount > 0}
                href={`/deficit?ym=${overviewYearMonth}`}
                linkLabel="赤字の理由"
              />
              <StatTile
                label="1kmあたり原価"
                value={kmPriceLabel(overview.costPerKm)}
                sub={`分岐 ${num(overview.thresholds.breakEvenKmPrice)}円`}
              />
            </div>
            <p className="mt-3 text-center text-xs text-ink-muted">
              <Link href="/dashboard" className="font-semibold text-brand-deep hover:underline">
                ダッシュボードで詳しく見る →
              </Link>
            </p>
          </section>
        )
      ) : null}

      {/*
        次点: 今月の入力作業がどこまで進んでいるか。分析の主役の下に続く形にし、
        「入力は締めるための手段」という位置づけを画面構成でも表す。
      */}
      <section className="mt-5 rounded-xl border border-brand bg-gradient-to-br from-white to-brand-soft p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-ink-muted">
            次にやること
            <span className="num ml-1.5 font-normal text-ink-muted/80">({yearMonthLabel(yearMonth)}度)</span>
          </p>
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
            {/*
              見出しだけを大きく置くと「STEP 1 車両実績表等の取り込み」という名詞の羅列になり、
              初めて開いた人には何をすればよいか伝わらない。何月分を・どの手順から始めればよいかを
              1つの文章として読める形にする。
            */}
            <p className="text-xl font-bold leading-relaxed text-ink sm:text-2xl">
              {progress.doneCount === 0 ? "まずは" : "次は"}
              <span className="num">{yearMonthLabel(yearMonth)}度</span>の
              <br className="hidden sm:block" />
              STEP {next.step.id}「{next.step.title}」から始めましょう
            </p>
            {/*
              見出しとボタンだけで「次に何を押すか」は伝わる。ステップの中身の説明まで常時出すと
              押す前に読む文章が増えるので、折りたたみへ移す(文章はそのまま)。
              進み具合(detail)は数字なので出したままにする。
            */}
            <Disclosure tone="inline" summary="このステップで何をしますか?">
              {next.step.summary}
            </Disclosure>
            <p className="num mt-2 text-xs text-ink-muted">{next.detail}</p>
            <Link
              href={withYm(next.step.href, yearMonth)}
              className="pressable mt-5 inline-block rounded-md bg-accent px-6 py-3 text-base font-bold text-white hover:bg-accent-deep"
            >
              STEP {next.step.id} を開く
            </Link>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-2xl font-bold text-ink sm:text-3xl">今月の締めは完了しています</p>
            <p className="mt-1.5 text-sm text-ink-muted">月次収支表・年間集計は最新です</p>
            <Link
              href={withYm("/grid", yearMonth)}
              className="pressable mt-5 inline-block rounded-md border border-brand bg-white px-6 py-3 text-base font-bold text-brand-deep hover:bg-brand-soft"
            >
              月次収支表を見る
            </Link>
          </div>
        )}
      </section>

      {/*
        全体の手順。いま取り組むステップは上の「次にやること」で大きく出しているので、
        8ステップの一覧そのものは折りたたむ。残り件数は畳んだ見出しに出したままにして、
        全8ステップの存在と進み具合は開かなくても分かるようにする。
      */}
      <Disclosure
        summary={`作成手順(全8ステップ)を見る(残り ${progress.totalCount - progress.doneCount}件)`}
      >
        <ol className="grid gap-2">
          {progress.steps.map((s) => (
            <li key={s.step.id}>
              <WorkflowStepCard
                progress={s}
                isNext={next?.step.id === s.step.id}
                yearMonth={yearMonth}
              />
            </li>
          ))}
        </ol>
      </Disclosure>

      {/* ダッシュボードは最上段のサマリに導線があるので、ここでは他の閲覧系画面だけを並べる */}
      <Disclosure summary="もっと詳しく見る">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/grid", label: "月次収支表", desc: "車両別の内訳を確認する" },
            { href: "/annual", label: "年間集計・対前年", desc: "13ヶ月の推移と前年比" },
            { href: "/deficit", label: "赤字の理由", desc: "赤字車両を3分類で見る" },
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
      </Disclosure>
    </>
  );
}
