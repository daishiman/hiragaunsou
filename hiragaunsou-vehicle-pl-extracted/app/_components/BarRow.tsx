/**
 * 横棒 (モック core.js の barRow に対応)。
 * 「何に対する長さか」を必ず言えるように、max(=100%の基準)を呼び出し側に必須で渡させる。
 * 数値ラベルを常に併記し、図形だけで意味を伝えない。
 */
export function BarRow({
  label,
  value,
  max,
  display,
  tone = "brand",
  sub,
}: {
  label: string;
  value: number;
  /** 100% とみなす基準値 (同一単位の実数比較。0以下なら棒は描かない) */
  max: number;
  /** 表示用の文字列 (単位付き) */
  display: string;
  tone?: "brand" | "danger" | "quiet";
  sub?: string;
}) {
  const ratio = max > 0 ? Math.min(Math.abs(value) / max, 1) : 0;
  const fill =
    tone === "danger" ? "bg-danger" : tone === "quiet" ? "bg-ink-muted/40" : "bg-brand";

  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-ink-muted">{label}</span>
        <span
          className={`num shrink-0 text-sm font-bold ${tone === "danger" ? "text-danger" : "text-ink"}`}
        >
          {display}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      {sub && <p className="mt-0.5 text-[11px] text-ink-muted">{sub}</p>}
    </div>
  );
}
