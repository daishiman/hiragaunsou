import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../../src/infrastructure/db/client";
import { D1ImprovementRepository } from "../../../../../src/infrastructure/db/D1ImprovementRepository";
import {
  improvementStatusLabel,
  improvementStatusTone,
} from "../../../../../src/domain/rules/improvement";
import {
  displayStateOf,
  instructionStateLabel,
} from "../../../../../src/domain/rules/improvementInstructionSync";
import { publishExclusionReason } from "../../../../../src/domain/rules/improvementLifecycle";
import {
  retentionDaysOf,
  retentionNoticeText,
} from "../../../../../src/domain/rules/improvementRetention";
import { AccessDenied } from "../../../../_components/AccessDenied";
import { PageHead } from "../../../../_components/PageHead";
import { Badge } from "../../../../_components/Badge";
import { dateTimeLabel } from "../../../../_lib/format";
import { ImprovementHandlingForm } from "./ImprovementHandlingForm";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ImprovementInstructionPanel } from "./ImprovementInstructionPanel";
import { ImprovementLifecyclePanel } from "./ImprovementLifecyclePanel";

/**
 * /admin/improvements/[id]: 届いた要望1件の詳細 (manage_improvements=管理者専用)。
 *
 * 一覧では画像を読まない。ここで初めて1枚だけ読む
 * (一覧で全件の画像を読むと、件数が増えるほど開かなくなる)。
 */
export default async function AdminImprovementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "manage_improvements")) {
    return <AccessDenied screenName="改善要望" permission="manage_improvements" />;
  }

  const { id } = await params;
  const { env } = await getCloudflareContext({ async: true });
  const repo = new D1ImprovementRepository(createDb(env.DB));
  const [item, all, audit] = await Promise.all([repo.findById(id), repo.listAll(), repo.auditOf(id)]);

  if (!item) {
    return (
      <div>
        <PageHead kind="tool" title="改善要望" />
        <div className="card px-6 py-10 text-center">
          <p className="text-sm font-semibold text-ink">この要望は見つかりませんでした。</p>
          <p className="mt-1 text-sm text-ink-muted">一覧から選び直してください。</p>
          <Link href="/admin/improvements" className="btn btn-primary pressable mt-4 inline-block">
            改善要望の一覧へ戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHead kind="tool" title="改善要望" />

      <div className="mt-1">
        <Link href="/admin/improvements" className="text-xs text-brand-deep underline">
          ← 改善要望の一覧へ戻る
        </Link>
      </div>

      <div className="card mt-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={improvementStatusTone(item.status)}>
            {improvementStatusLabel(item.status)}
          </Badge>
          {item.archivedAt !== null && <Badge tone="neutral">廃棄済み</Badge>}
          <span className="text-sm font-bold text-ink">{item.screenLabel}</span>
          <span className="ml-auto text-xs text-ink-muted">
            {item.reporterName || "利用者"}・{dateTimeLabel(item.createdAt.getTime())}
          </span>
        </div>

        <p className="mt-3 text-sm whitespace-pre-wrap text-ink">{item.body}</p>

        <dl className="mt-4 grid gap-1 text-xs text-ink-muted sm:grid-cols-2">
          <div>
            <dt className="inline font-semibold">開いていた画面: </dt>
            {/* 実URL。同じ画面でも「どの車両を見ていたか」で再現できることがある */}
            <dd className="inline">
              <Link href={item.path} className="text-brand-deep underline">
                {item.path}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold">集計の単位: </dt>
            <dd className="inline">{item.routePattern}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">画面の大きさ: </dt>
            <dd className="inline">{item.viewport ?? "—"}</dd>
          </div>
          {item.duplicateOfId && (
            <div>
              <dt className="inline font-semibold">まとめ先: </dt>
              <dd className="inline">
                <Link
                  href={`/admin/improvements/${item.duplicateOfId}`}
                  className="text-brand-deep underline"
                >
                  この要望がまとめられた先を開く
                </Link>
              </dd>
            </div>
          )}
          {item.handledAt && (
            <div>
              <dt className="inline font-semibold">最後に決めた人: </dt>
              <dd className="inline">
                {item.handledByName ?? "—"}・{dateTimeLabel(item.handledAt.getTime())}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {item.shot ? (
        <div className="card mt-3 px-4 py-4">
          <p className="text-xs font-semibold text-ink">送られてきた画面の写し</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            赤・橙・青・黒の書き込みは送った本人の指摘です。黒く塗られた部分は本人が隠したところです。
          </p>
          {/*
            送られてきた1枚をそのまま出す。data URL なので外部通信は発生せず、
            next/image の最適化も通せない (通す意味も無い)。
          */}
          <img
            src={item.shot}
            alt={`${item.screenLabel}の画面の写し（送った人の書き込み入り）`}
            className="mt-2 w-full rounded-[var(--radius-control)] border border-line"
          />
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-muted">
          この要望に画像は付いていません（文章だけで送られています）。
        </p>
      )}

      <DiagnosticsPanel d={item.diagnostics} />

      {/*
        いつ消えるかを、消える前に出しておく。あとから「あったはずの写しが無い」と
        言われてから説明するより、見えている場所に置いておく方が早い。
      */}
      <p className="mt-2 text-[11px] text-ink-muted">
        {retentionNoticeText(retentionDaysOf(env.IMPROVEMENT_RETENTION_DAYS))}
      </p>

      <ImprovementInstructionPanel
        id={item.id}
        stateLabel={instructionStateLabel(displayStateOf(item))}
        note={
          publishExclusionReason(item) ??
          (item.instruction ? `v${item.instruction.version}` : "まだ渡していません")
        }
      />

      <div className="mt-3">
        <ImprovementHandlingForm
          id={item.id}
          currentStatus={item.status}
          currentNote={item.handledNote ?? ""}
          currentDuplicateOfId={item.duplicateOfId}
          siblings={all
            .filter((r) => r.id !== item.id)
            .map((r) => ({ id: r.id, label: `${r.screenLabel}: ${r.body.slice(0, 30)}` }))}
        />
      </div>

      <ImprovementLifecyclePanel
        id={item.id}
        archived={item.archivedAt !== null}
        canPurge={checkAccess(session, "purge_improvements")}
      />

      {/* 誰がいつ何をしたか。完全削除の記録もここに残る (記録自体は消さない) */}
      {audit.length > 0 && (
        <div className="card mt-3 px-4 py-4">
          <p className="text-xs font-semibold text-ink">この要望に対して行われたこと</p>
          <ul className="mt-2 space-y-1 text-xs text-ink-muted">
            {audit.map((a, i) => (
              <li key={i}>
                {dateTimeLabel(a.at.getTime())}・{a.actorName}・{AUDIT_LABEL[a.action] ?? a.action}
                {a.toStatus && `（${a.toStatus}）`}
                {a.reason && `：${a.reason}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const AUDIT_LABEL: Record<string, string> = {
  status_change: "状態を変えた",
  archive: "廃棄した",
  restore: "廃棄から戻した",
  purge: "完全に削除した",
  instruction_publish: "指示文を発行した",
  instruction_revise: "指示文を更新した",
  instruction_withdraw: "指示文を取り下げた",
  instruction_fetch: "Claude Code が指示文を読み込んだ",
  token_issue: "渡すための鍵を作った",
  token_revoke: "渡すための鍵を失効させた",
};
