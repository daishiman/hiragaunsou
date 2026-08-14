import Link from "next/link";
import { redirect } from "next/navigation";
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
import { Badge } from "../../../_components/Badge";
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
  searchParams: Promise<{ status?: string; screen?: string; period?: string }>;
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

  const { env } = await getCloudflareContext({ async: true });
  const all = await new D1ImprovementRepository(createDb(env.DB)).listAll();

  const counts = countImprovementsByStatus(all);
  const byScreen = groupImprovementsByScreen(all);
  const rows = filterImprovements(all, {
    status,
    routePattern: screen,
    since: improvementPeriodStart(period, new Date()),
  });

  const linkTo = (next: { status?: string | null; screen?: string | null; period?: string }) => {
    const q = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    const sc = next.screen === undefined ? screen : next.screen;
    const p = next.period ?? period;
    if (s) q.set("status", s);
    if (sc) q.set("screen", sc);
    if (p !== "all") q.set("period", p);
    const query = q.toString();
    return query ? `/admin/improvements?${query}` : "/admin/improvements";
  };

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
              すべて {all.length}件
            </FilterLink>
            {IMPROVEMENT_STATUSES.map((s) => (
              <FilterLink key={s} href={linkTo({ status: s })} active={status === s}>
                {improvementStatusLabel(s)} {counts[s]}件
              </FilterLink>
            ))}
          </div>

          {/* 期間 */}
          <div className="mt-2 flex flex-wrap gap-2">
            {IMPROVEMENT_PERIODS.map((p) => (
              <FilterLink key={p} href={linkTo({ period: p })} active={period === p}>
                {IMPROVEMENT_PERIOD_LABEL[p]}
              </FilterLink>
            ))}
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

          {/* 3. 届いた本文。1件ずつ長さが違うので、表ではなく1件1枚で読ませる */}
          <div className="mt-5 space-y-3">
            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center text-sm text-ink-muted">
                この絞り込みに当てはまるものはありません。上の条件を広げてください。
              </p>
            ) : (
              rows.map((r) => (
                <Link
                  key={r.id}
                  href={`/admin/improvements/${r.id}`}
                  className="card block px-4 py-3 hover:bg-brand-mist"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={improvementStatusTone(r.status)}>
                      {improvementStatusLabel(r.status)}
                    </Badge>
                    <span className="text-xs font-semibold text-ink">{r.screenLabel}</span>
                    {r.hasShot && <Badge tone="neutral">画像あり</Badge>}
                    <span className="ml-auto text-xs text-ink-muted">
                      {r.reporterName || "利用者"}・{dateTimeLabel(r.createdAt.getTime())}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-sm text-ink">{r.body}</p>
                  {r.handledNote && (
                    <p className="mt-1 text-xs text-ink-muted">対応メモ: {r.handledNote}</p>
                  )}
                </Link>
              ))
            )}
          </div>
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
