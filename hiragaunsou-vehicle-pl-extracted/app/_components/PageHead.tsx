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
 */
export function PageHead({
  kind,
  title,
  lead,
  action,
}: {
  kind: NavGroup["kind"];
  title: string;
  lead?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <span
          className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${KIND_STYLE[kind]}`}
        >
          {KIND_LABELS[kind]}
        </span>
        <h1 className="mt-2 text-xl font-bold text-ink">{title}</h1>
        {lead && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{lead}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
