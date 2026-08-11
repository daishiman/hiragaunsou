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
import { isYearMonth, selectableYearMonths } from "../_lib/yearMonth";
import { resolveOverviewYearMonth, resolveWorkingYearMonth } from "../_lib/workingYearMonth";
import { yearMonthLabel, man, num, kmPriceLabel, pct } from "../_lib/format";
import { withYm } from "../_lib/withYm";
import { ScreenHeader } from "../_components/ScreenHeader";
import { EmptyState } from "../_components/EmptyState";
import { StatTile } from "../_components/StatTile";
import { Disclosure } from "../_components/Disclosure";
import { YearMonthSelect } from "../_components/YearMonthSelect";
import { StickyFilterBar } from "../_components/StickyFilterBar";
import { WorkflowStepCard } from "../_components/WorkflowStepCard";
import { findScreen } from "../_lib/screens";

/**
 * ホーム。
 *
 * 見る人にとって主目的は「儲かっているか(分析)」であり、入力作業はそれを支える手段でしかない。
 * そのため画面の最上段は直近で締めた月の経営サマリ(ダッシュボードの要約)とし、
 * その下に「次にやること」という入力作業の進行案内を続ける2段構成にしている。
 *
 * 器の判定 (T7 §4-1): この画面で人がやるのは「1件(締め済み直近月と、いま進めている月)を
 * 読んで次の一手を決めること」であって列をまたいだ比較ではない。よって表は使わず、
 * 結論の数字は要約カード(StatTile)、手順は1件ずつのカードで出す。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const { ym } = await searchParams;
  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);

  /*
    最上段の経営サマリは「締めた月の数字」を見せる場所。前月固定だったため、
    確定した月が1つも無くても前月の数字を出してしまい、取込ゼロの月に収支表だけが
    残っていると売上0円・赤字だけのサマリが一番上に出ていた。
    確定済みの直近月 → 無ければ取込のある最新月、と実データから決める。
  */
  const overviewTarget = await resolveOverviewYearMonth(db);
  const overviewYearMonth = overviewTarget.yearMonth;

  /*
    「次にやること」が話題にする月。当月固定だったため、5月分を取り込んでもホームは
    当月の話をし続け、取り込んだ内容がどこにも出てこないように見えていた。
    実データから「まだ締めていない、取込のある最も新しい月」を採り、
    利用者が別の月を見たいときは ?ym= で切り替えられるようにする。
  */
  const yearMonth = isYearMonth(ym) ? ym : await resolveWorkingYearMonth(db);

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
      <ScreenHeader screen="/" />

      {/*
        対象年月と進み具合は「いま画面に出ている数字が何月のものか」を決める前提なので、
        スクロールしても消えないように帯へ貼る (T7 §2-3)。工程タブの無い画面なので below は既定。
      */}
      <StickyFilterBar
        summary={
          <>
            <span className="num">{progress.doneCount}</span> /{" "}
            <span className="num">{progress.totalCount}</span> ステップ完了
          </>
        }
      >
        <YearMonthSelect basePath="/" value={yearMonth} options={selectableYearMonths(13)} />
      </StickyFilterBar>

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
          />
        ) : (
          <section>
            {/*
              締めた月の数字か、まだ締めていない作業中の月の途中経過かで数字の重みが違う。
              どちらも「直近の月」ではあるので、見出しでどちらなのかを言い切る。
            */}
            <p className="text-xs font-semibold text-ink-muted">
              {overview.label}度 経営サマリ
              {overviewTarget.basis === "confirmed" ? "（締め済み直近月）" : "（締め作業中・途中経過）"}
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                hero
                label={`${overview.label} 損益`}
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
      {/*
        面は .card に揃える (design-system §11-3)。この節だけ主役として brand の面を敷く。
        対象年月の切り替えは上の帯へ移した (スクロールで消えると何月の話か分からなくなるため)。
        件数はこの下の進み具合の棒を読むためのラベルなので、棒の隣に残す。
      */}
      <section className="card mt-5 border-brand bg-brand-soft p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-ink-muted">
            次にやること
            <span className="num ml-1.5 font-normal text-ink-muted/80">（{yearMonthLabel(yearMonth)}度）</span>
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
            {/*
              行き先はステップの入口ではなく「続きができる画面」。
              例: STEP2の取込が済んでいれば /import ではなくデータ整形やキリン配賦へ送る。
              ボタンの文言も、そこで何をするのかが分かる言葉に差し替える。
            */}
            <Link
              href={withYm(next.href, yearMonth)}
              className="btn btn-primary pressable mt-5 inline-block"
            >
              {next.actionLabel ?? `STEP ${next.step.id} を開く`}
            </Link>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-2xl font-bold text-ink sm:text-3xl">今月の締めは完了しています</p>
            <p className="mt-1.5 text-sm text-ink-muted">月次収支表・年間集計は最新です</p>
            <Link
              href={withYm("/grid", yearMonth)}
              className="btn btn-secondary pressable mt-5 inline-block"
            >
              月次収支表を見る
            </Link>
          </div>
        )}
        {/*
          8つの手順の全体像。ふだんは「次にやること」1つだけ見えていれば足りるので畳んでおく。
          ただし「あと何が残っているのか」「さっきの手順に戻りたい」は必ず起きるため、
          全部の手順とその進み具合をこの1箇所から開けるようにしておく。
        */}
        <Disclosure summary={`8つの手順を全部見る（${progress.doneCount} / ${progress.totalCount} 完了）`}>
          <div className="flex flex-col gap-1.5">
            {progress.steps.map((s) => (
              <WorkflowStepCard
                key={s.step.id}
                progress={s}
                isNext={false}
                yearMonth={yearMonth}
              />
            ))}
          </div>
        </Disclosure>
      </section>

      {/* ダッシュボードは最上段のサマリに導線があるので、ここでは他の閲覧系画面だけを並べる */}
      <Disclosure summary="もっと詳しく見る">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {/* 行き先の呼び名と説明は screens.ts が正本。ここで別名を作らない (T7 §1) */}
          {["/grid", "/annual", "/deficit"].map((href) => {
            const s = findScreen(href);
            if (!s) return null;
            return (
              <Link key={href} href={href} className="btn btn-quiet pressable">
                <p className="text-sm font-semibold text-ink">{s.label}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{s.desc}</p>
              </Link>
            );
          })}
        </div>
      </Disclosure>
    </>
  );
}
