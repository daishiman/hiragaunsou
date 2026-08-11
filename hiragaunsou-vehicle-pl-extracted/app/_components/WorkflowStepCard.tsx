import Link from "next/link";
import type { WorkflowStepProgress } from "../../src/usecase/steps/getWorkflowProgress";
import { withYm } from "../_lib/withYm";

const MODE_LABEL: Record<string, string> = {
  import: "取込",
  entry: "入力",
  check: "確認",
};

const STATUS_LABEL: Record<string, string> = {
  todo: "未着手",
  partial: "入力途中",
  done: "完了",
};

/** 状態は色だけで伝えない。記号+文字ラベルの両方を必ず出す。 */
const STATUS_MARK: Record<string, string> = {
  todo: "○",
  partial: "◐",
  done: "✓",
};

/**
 * 業務フロー1ステップの行。
 *
 * 段階的開示(プログレッシブディスクロージャー): 「今やるべきこと」以外を最初から
 * 大きく見せると認知負荷が上がるため、いま取り組むステップ(isNext)だけを大きく・
 * 目立つ色で表示し、完了済み・まだ先のステップは小さく静かなコンパクト行にする。
 * 情報を消すわけではなく、詳細は <details> でいつでも参照できる状態を保つ。
 */
export function WorkflowStepCard({
  progress,
  isNext,
  yearMonth,
}: {
  progress: WorkflowStepProgress;
  isNext: boolean;
  /**
   * 進捗を集計している対象月。手順を開くリンクに引き継ぐ。
   * これが無いと、ホームが「2026年8月度」の進捗を出しているのに /import は既定の前月
   * (2026-07)を開いてしまい、見ていた月と作業する月がずれる。
   */
  yearMonth?: string;
}) {
  const { step, status, detail, blocked } = progress;

  if (!isNext) {
    return <CompactRow progress={progress} yearMonth={yearMonth} />;
  }

  return (
    <div className="rounded-xl border border-brand bg-white p-4 ring-1 ring-brand-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num shrink-0 rounded-md bg-brand px-2.5 py-1 text-sm font-bold text-white">
          STEP {step.id}
        </span>
        <span className="min-w-0 flex-1 truncate text-base font-bold text-ink">{step.title}</span>
        <span className="shrink-0 rounded-full border border-line bg-subtle px-2 py-0.5 text-[11px] text-ink-muted">
          {MODE_LABEL[step.mode]}
        </span>
        <span className="shrink-0 rounded-full border border-caution-border bg-caution-soft px-2.5 py-0.5 text-[11px] font-semibold text-ink">
          <span aria-hidden>{STATUS_MARK[status]}</span> {STATUS_LABEL[status]}
        </span>
      </div>

      <p className="num mt-2 text-sm text-ink">{detail}</p>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-brand-deep">
          この手順について
          {step.notes.length > 0 ? `（判定ポイント ${step.notes.length}件）` : ""}
        </summary>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{step.summary}</p>
        <p className="mt-1 text-xs text-ink-muted">出典: {step.source}</p>
        {step.notes.length > 0 && (
          <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-ink-muted">
            {step.notes.map((n) => (
              <li key={n}>・{n}</li>
            ))}
          </ul>
        )}
        {step.isJudgementHeavy && (
          <p className="mt-2 rounded-md border border-caution-border bg-caution-soft px-3 py-2 text-xs leading-relaxed">
            経験に頼っている判定が残っています。迷ったら請求書発行担当に確認してください。
          </p>
        )}
      </details>

      <div className="mt-3">
        {blocked ? (
          <p className="text-xs text-ink-muted">STEP 1・2 の取込が終わると着手できます</p>
        ) : (
          <Link
            href={withYm(step.href, yearMonth)}
            className="btn btn-primary pressable inline-block"
          >
            この手順を開く
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * 完了済み・まだ先のステップの表示。
 * 1行に畳んで小さく・控えめに置き、クリックすれば詳細(判断ポイント・出典・リンク)を開ける。
 */
function CompactRow({
  progress,
  yearMonth,
}: {
  progress: WorkflowStepProgress;
  yearMonth?: string;
}) {
  const { step, status, detail, blocked } = progress;

  const rowClass = [
    "group rounded-lg border bg-white px-3 py-2",
    status === "done" ? "border-line" : "border-line border-dashed",
    blocked ? "opacity-60" : "",
  ].join(" ");

  return (
    <details className={rowClass}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
        <span className="num shrink-0 rounded bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
          STEP {step.id}
        </span>
        <span
          className={`min-w-0 flex-1 truncate ${
            status === "done" ? "text-ink-muted line-through decoration-1" : "text-ink-muted"
          }`}
        >
          {step.title}
        </span>
        <span className="shrink-0 text-[10px] font-medium text-ink-muted">
          <span aria-hidden>{STATUS_MARK[status]}</span> {STATUS_LABEL[status]}
        </span>
      </summary>

      <div className="mt-2 border-t border-line pt-2">
        <p className="num text-[11px] text-ink-muted">{detail}</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">{step.summary}</p>
        {step.notes.length > 0 && (
          <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-ink-muted">
            {step.notes.map((n) => (
              <li key={n}>・{n}</li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          {blocked ? (
            <p className="text-[11px] text-ink-muted">STEP 1・2 の取込が終わると着手できます</p>
          ) : (
            <Link
              href={withYm(step.href, yearMonth)}
              className="btn btn-quiet pressable inline-block text-[11px]"
            >
              {status === "done" ? "内容を見直す" : "この手順を開く"}
            </Link>
          )}
        </div>
      </div>
    </details>
  );
}
