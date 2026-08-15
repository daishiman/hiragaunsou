import Link from "next/link";
import { redirect } from "next/navigation";
import { ImprovementBulkTable, type BulkRow } from "./ImprovementBulkTable";
import { issueExclusionReason } from "../../../../src/domain/rules/improvementLifecycle";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../src/infrastructure/db/D1ImprovementRepository";
import {
  countImprovementsByStatus,
  filterImprovements,
  groupImprovementsByScreen,
  improvementPeriodStart,
  improvementStatusLabel,
  improvementStatusTone,
  isImprovementPeriod,
  isImprovementStatus,
  IMPROVEMENT_PERIOD_LABEL,
  IMPROVEMENT_PERIODS,
  IMPROVEMENT_STATUSES,
  type ImprovementPeriod,
  type ImprovementStatus,
} from "../../../../src/domain/rules/improvement";
import { AccessDenied } from "../../../_components/AccessDenied";
import { ScreenHeader } from "../../../_components/ScreenHeader";
import { dateTimeLabel } from "../../../_lib/format";

/**
 * /admin/improvements: 各画面から届いた改善要望の一覧 (manage_improvements=管理者専用)。
 *
 * この画面ですること: 何が言われているかを掴み、直すものを決める。
 * そのために必要なのは次の3つで、上から順に置く。
 *   1. いま手つかずの件数 (未対応が溜まっていないか)
 *   2. どの画面に集まっているか (直す順番を決める手がかり)
 *   3. 届いた本文そのもの (実際に何を困っているか)
 *
 * 絞り込みは URL のクエリで持つ。管理者どうしで「この絞り込みの状態を見て」と
 * URL を渡せるようにするため、画面の中だけの状態にしない。
 */
export default async function AdminImprovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; screen?: string; period?: string; archive?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "manage_improvements")) {
    return <AccessDenied screenName="改善要望" permission="manage_improvements" />;
  }

  const params = await searchParams;
  const status: ImprovementStatus | null =
    params.status && isImprovementStatus(params.status) ? params.status : null;
  const period: ImprovementPeriod =
    params.period && isImprovementPeriod(params.period) ? params.period : "all";
  const screen = params.screen ?? null;
  // 既定は廃棄したものを隠す。押し間違いで廃棄したものを探せなくならないよう、
  // 「廃棄したもの」に切り替えれば同じ表で見られて、そこから戻せる。
  const archive: "active" | "archived" | "all" =
    params.archive === "archived" || params.archive === "all" ? params.archive : "active";

  const { env } = await getCloudflareContext({ async: true });
  const all = await new D1ImprovementRepository(createDb(env.DB)).listAll();

  // 件数の札は、いま見えている範囲 (廃棄の扱い) に合わせて数える。
  // 表に7件しか出ていないのに札が20件と言う状態を作らない。
  const inScope = filterImprovements(all, { archive });
  const counts = countImprovementsByStatus(inScope);
  const byScreen = groupImprovementsByScreen(inScope);
  const rows = filterImprovements(all, {
    status,
    routePattern: screen,
    since: improvementPeriodStart(period, new Date()),
    archive,
  });

  const linkTo = (next: {
    status?: string | null;
    screen?: string | null;
    period?: string;
    archive?: string;
  }) => {
    const q = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    const sc = next.screen === undefined ? screen : next.screen;
    const p = next.period ?? period;
    const a = next.archive ?? archive;
    if (s) q.set("status", s);
    if (sc) q.set("screen", sc);
    if (p !== "all") q.set("period", p);
    if (a !== "active") q.set("archive", a);
    const query = q.toString();
    return query ? `/admin/improvements?${query}` : "/admin/improvements";
  };

  // 表に渡す形。Date と重い値をここで文字にしておく (クライアントへは軽い形だけ渡す)。
  const tableRows: BulkRow[] = rows.map((r) => {
    const excluded = issueExclusionReason({ status: r.status, archivedAt: r.archivedAt });
    // 「更新あり」は内容の指紋ではなく時刻で見る。一覧の判定のために
    // 全件の診断情報を読み直すのは重すぎるため。実際に送るかどうかは
    // 送信時に指紋で厳密に判定する (変わっていなければ何も送らない)。
    const outdated =
      r.githubIssueNumber !== null &&
      r.githubSyncedAt !== null &&
      r.updatedAt.getTime() > r.githubSyncedAt.getTime();
    return {
      id: r.id,
      status: r.status,
      statusLabel: improvementStatusLabel(r.status),
      statusTone: improvementStatusTone(r.status),
      screenLabel: r.screenLabel,
      body: r.body,
      reporterName: r.reporterName,
      createdAtLabel: dateTimeLabel(r.createdAt.getTime()),
      hasShot: r.hasShot,
      archived: r.archivedAt !== null,
      issueNumber: r.githubIssueNumber,
      issueUrl: r.githubIssueUrl,
      issueState: excluded ? "excluded" : outdated ? "outdated" : r.githubIssueNumber !== null ? "issued" : "none",
      issueStateNote: excluded
        ? excluded
        : r.githubIssueNumber === null
          ? "まだ送っていません"
          : outdated
            ? "送ったあとに更新あり"
            : r.githubIssueState === "closed"
              ? "起票済み（閉じています）"
              : "起票済み",
    };
  });

  return (
    <div>
      <ScreenHeader
        screen="/admin/improvements"
        lead={`各画面の右下から届いた声です。全${all.length}件のうち、未対応が${counts.open}件あります。`}
      />

      {all.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink">まだ届いていません。</p>
          <p className="mt-1 text-sm text-ink-muted">
            どの画面でも右下の「改善要望」から送れます。届くとこの一覧に並びます。
          </p>
        </div>
      ) : (
        <>
          {/* 1. 状態ごとの件数。0件の状態も欠かさず並べる (無い札を探させない) */}
          <div className="mt-4 flex flex-wrap gap-2">
            <FilterLink href={linkTo({ status: null })} active={status === null}>
              すべて {inScope.length}件
            </FilterLink>
            {IMPROVEMENT_STATUSES.map((s) => (
              <FilterLink key={s} href={linkTo({ status: s })} active={status === s}>
                {improvementStatusLabel(s)} {counts[s]}件
              </FilterLink>
            ))}
          </div>

          {/* 期間と、廃棄したものの表示 */}
          <div className="mt-2 flex flex-wrap gap-2">
            {IMPROVEMENT_PERIODS.map((p) => (
              <FilterLink key={p} href={linkTo({ period: p })} active={period === p}>
                {IMPROVEMENT_PERIOD_LABEL[p]}
              </FilterLink>
            ))}
            <span className="mx-1 self-center text-xs text-ink-muted">|</span>
            <FilterLink href={linkTo({ archive: "active" })} active={archive === "active"}>
              廃棄を除く
            </FilterLink>
            <FilterLink href={linkTo({ archive: "archived" })} active={archive === "archived"}>
              廃棄したものだけ
            </FilterLink>
            <FilterLink href={linkTo({ archive: "all" })} active={archive === "all"}>
              廃棄も含める
            </FilterLink>
          </div>

          {/* 2. どの画面に集まっているか。実URLではなく画面の単位で数える */}
          <div className="mt-5">
            <p className="text-xs font-semibold text-ink">どの画面から届いたか</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <FilterLink href={linkTo({ screen: null })} active={screen === null}>
                すべての画面
              </FilterLink>
              {byScreen.map((g) => (
                <FilterLink
                  key={g.routePattern}
                  href={linkTo({ screen: g.routePattern })}
                  active={screen === g.routePattern}
                >
                  {g.screenLabel} {g.count}件
                </FilterLink>
              ))}
            </div>
          </div>

          {/* 3. 届いた本文。まとめて Issue に送る・まとめて整理する作業をするので表で並べる */}
          {rows.length === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center text-sm text-ink-muted">
              この絞り込みに当てはまるものはありません。上の条件を広げてください。
            </p>
          ) : (
            <ImprovementBulkTable
              rows={tableRows}
              canPurge={checkAccess(session, "purge_improvements")}
            />
          )}
        </>
      )}
    </div>
  );
}

/** 絞り込みの札。押せるものはタッチでも 44px 以上を保つ (feedback-chip と同じ決まり)。 */
function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="feedback-chip" aria-current={active ? "true" : undefined}>
      {children}
    </Link>
  );
}
