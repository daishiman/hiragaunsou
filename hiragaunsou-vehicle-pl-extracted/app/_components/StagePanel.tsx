"use client";

import { useState, type ReactNode } from "react";

/**
 * 段階パネル。見出しと要約だけを出しておき、ボタンを押したときに中身(表・入力欄)を出す。
 *
 * 「全部そこにある」画面は、初めて開いた人がどこから手を付けるか決められない。
 * 押すまで出さないことで、初期表示に残るのは見出し1行と数字だけになる。
 * 中身は消えていないので、必要になった人は1クリックで到達できる。
 */
export function StagePanel({
  step,
  title,
  summary,
  openLabel = "開く",
  closeLabel = "閉じる",
  defaultOpen = false,
  children,
}: {
  /** 手順の番号。番号を持たない画面では省略する */
  step?: number | string;
  title: string;
  /** 開く前でも読める要約(件数など)。「開いてみないと分からない」を作らないための欄 */
  summary?: ReactNode;
  openLabel?: string;
  closeLabel?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">
          {step !== undefined ? (
            <span className="num mr-1.5 text-ink-muted">{step}</span>
          ) : null}
          {title}
        </h2>
        <div className="flex items-baseline gap-3">
          {summary ? <span className="text-xs text-ink-muted">{summary}</span> : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="btn btn-quiet btn-sm pressable"
          >
            {open ? closeLabel : openLabel}
          </button>
        </div>
      </div>
      {open ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}
