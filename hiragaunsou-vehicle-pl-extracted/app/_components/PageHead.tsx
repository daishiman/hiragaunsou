import Link from "next/link";
import { KIND_LABELS, type NavGroup } from "../_lib/navigation";

const KIND_STYLE: Record<NavGroup["kind"], string> = {
  ops: "bg-accent/10 text-accent-deep",
  data: "bg-brand-soft text-brand-deep",
  analysis: "bg-brand-soft text-brand-deep",
  spec: "bg-subtle text-ink-muted",
  tool: "bg-subtle text-ink-muted",
};

/**
 * 全画面共通のページ見出し (モックの .page-head / .page-kind / .page-lead に対応)。
 * 「今どの種類の画面にいるか(運用/データ/分析/仕様)」を先に示してから本題に入る。
 *
 * showHomeLink: 業務フロー(毎月の締め)のページだけに出す「進行状況に戻る」導線。
 * サイドバー経由で各画面に直接入った人でも、迷ったらホームの進行画面に戻れるようにする。
 */
export function PageHead({
  kind,
  title,
  lead,
  action,
  help,
  showHomeLink,
}: {
  kind: NavGroup["kind"];
  title: string;
  lead?: string;
  action?: React.ReactNode;
  /**
   * タイトルの横に出す「?」(HelpDrawer)。
   * この画面を初めて開いた人向けの長い説明は、本文に置かずここへ入れる。
   * 画面に残るのは ? の1文字だけになり、初期表示は操作に必要なものだけになる。
   */
  help?: React.ReactNode;
  showHomeLink?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {showHomeLink && (
          <Link
            href="/"
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-brand-deep hover:underline"
          >
            ← 進行状況(ホーム)に戻る
          </Link>
        )}
        <div>
          <span
            className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${KIND_STYLE[kind]}`}
          >
            {KIND_LABELS[kind]}
          </span>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-xl font-bold text-ink">{title}</h1>
            {help}
          </div>
          {lead && (
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              {/*
                「。」で区切った1文を塊として折り返す。
                そのまま流すと「Enterで次の / 欄へ」のように文の途中で折れて、
                読み手は一度目を戻すことになる。文ごとなら次の行の頭から読める。
              */}
              {lead
                .split(/(?<=。)/)
                .filter((s) => s !== "")
                .map((sentence, i) => (
                  <span key={i} className="inline-block">
                    {sentence}
                  </span>
                ))}
            </p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
