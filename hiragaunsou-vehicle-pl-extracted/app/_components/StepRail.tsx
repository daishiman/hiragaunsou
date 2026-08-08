import type { ReactNode } from "react";

export interface StepRailItem {
  /** 札に出す短い名前 */
  label: string;
  /**
   * 札の左に出す番号。業務手順書に番号があるならその番号をそのまま使う。
   * 画面独自の通し番号を併記すると2つの番号が食い違い、現在地が分からなくなる。
   */
  badge?: string | number | null;
}

/**
 * ステップ札(手入力画面で使っていた進行レール部品を、全画面で使えるように独立させたもの)。
 *
 * 済 (✓) / 現在 / 未着手 を色と記号の両方で描き分ける(色だけに頼らない)。
 * onSelect を渡すと押して跳べる。渡さなければ現在地の表示だけになる
 * (取込のように順番どおりにしか進めない画面は跳べない方が正しい)。
 */
export function StepRail({
  steps,
  currentIndex,
  onSelect,
  trailing,
}: {
  steps: readonly StepRailItem[];
  currentIndex: number;
  onSelect?: (index: number) => void;
  /** 右端に出す補足(年月など) */
  trailing?: ReactNode;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {steps.map((s, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
        const className = [
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs",
          state === "current"
            ? "border-brand bg-brand font-bold text-white"
            : state === "done"
              ? "border-brand-soft bg-brand-soft font-semibold text-brand-deep"
              : "border-line bg-white text-ink-muted",
        ].join(" ");
        const inner = (
          <>
            <span className="num" aria-hidden>
              {state === "done" ? "✓" : (s.badge ?? i + 1)}
            </span>
            <span>{s.label}</span>
          </>
        );
        return (
          <li key={s.label}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={state === "current" ? "step" : undefined}
                className={`pressable ${className} ${state === "todo" ? "hover:bg-subtle" : ""}`}
              >
                {inner}
              </button>
            ) : (
              <span aria-current={state === "current" ? "step" : undefined} className={className}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
      {trailing ? <li className="num ml-auto text-xs text-ink-muted">{trailing}</li> : null}
    </ol>
  );
}
