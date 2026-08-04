import Link from "next/link";
import type { WorkflowStepProgress } from "../../src/usecase/steps/getWorkflowProgress";

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
 * このカードはホームに8枚並ぶ。1枚あたり4行 (説明・数値・出典・注記) 書くと
 * 画面が読み物になって「どこまで終わったか」が読み取れなくなるため、
 * 既定で見せるのは「番号・見出し・状態・数値」の4点だけにする。
 * 手順の説明・出典・判断ポイントは折りたたみへ逃がす。
 */
export function WorkflowStepCard({
  progress,
  isNext,
}: {
  progress: WorkflowStepProgress;
  isNext: boolean;
}) {
  const { step, status, detail, blocked } = progress;

  const statusClass =
    status === "done"
      ? "bg-subtle text-ink-muted border-line"
      : status === "partial"
        ? "bg-caution-soft text-ink border-caution-border"
        : "bg-white text-ink-muted border-line border-dashed";

  const containerClass = [
    "rounded-xl border bg-white p-4",
    isNext ? "border-brand ring-1 ring-brand-soft" : "border-line",
    blocked ? "opacity-60" : "",
  ].join(" ");

  return (
    <div className={containerClass}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="num shrink-0 rounded-md bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-deep">
          STEP {step.id}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{step.title}</span>
        <span className="shrink-0 rounded-full border border-line bg-subtle px-2 py-0.5 text-[11px] text-ink-muted">
          {MODE_LABEL[step.mode]}
        </span>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusClass}`}>
          <span aria-hidden>{STATUS_MARK[status]}</span> {STATUS_LABEL[status]}
        </span>
      </div>

      <p className="num mt-1.5 text-xs text-ink">{detail}</p>

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] font-semibold text-brand-deep">
          この手順について
          {step.notes.length > 0 ? `(判断ポイント ${step.notes.length}件)` : ""}
        </summary>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">{step.summary}</p>
        <p className="mt-1 text-[11px] text-ink-muted">出典: {step.source}</p>
        {step.notes.length > 0 && (
          <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-ink-muted">
            {step.notes.map((n) => (
              <li key={n}>・{n}</li>
            ))}
          </ul>
        )}
        {step.isJudgementHeavy && (
          <p className="mt-2 rounded-md border border-caution-border bg-caution-soft px-3 py-2 text-[11px] leading-relaxed">
            経験に頼っている判断が残っています。迷ったら請求書発行担当に確認してください。
          </p>
        )}
      </details>

      <div className="mt-3">
        {blocked ? (
          <p className="text-[11px] text-ink-muted">
            STEP 1・2 の取込が終わると着手できます
          </p>
        ) : (
          <Link
            href={step.href}
            className="pressable inline-block rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle"
          >
            {status === "done" ? "内容を見直す" : "この手順を開く"}
          </Link>
        )}
      </div>
    </div>
  );
}
