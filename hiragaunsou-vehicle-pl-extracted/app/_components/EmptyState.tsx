import Link from "next/link";
import { findScreen } from "../_lib/screens";

/**
 * 空状態。「状態の説明 + 次の1歩」を必ずセットで出す。
 *
 * 行き先の呼び名は書かずに app/_lib/screens.ts から取る。
 * 画面ごとに「月次データ取込へ」「データ取込へ進む」と書き分けていたため、
 * サイドバーの名前(データ取込)と一致せず、同じ場所が別の名前で呼ばれていた。
 */
export function EmptyState({
  title,
  description,
  actionHref = "/import",
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  const label = actionLabel ?? `${findScreen(actionHref)?.label ?? "データ取込"}へ進む`;
  return (
    <div className="rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
      <div className="mt-4">
        <Link
          href={actionHref}
          className="btn btn-primary pressable inline-block"
        >
          {label}
        </Link>
      </div>
    </div>
  );
}
