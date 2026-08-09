import Link from "next/link";

/** 空状態。「状態の説明 + 次の1歩」を必ずセットで出す。 */
export function EmptyState({
  title,
  description,
  actionHref = "/import",
  actionLabel = "データ取込へ",
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
      <div className="mt-4">
        <Link
          href={actionHref}
          className="btn btn-primary pressable inline-block"
        >
          {actionLabel}
        </Link>
      </div>
    </div>
  );
}
