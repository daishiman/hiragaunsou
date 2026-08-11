import type { ReactNode } from "react";

/**
 * 話題の変わり目に置く見出し。
 *
 * 区切り線は飾りではなく「ここから別の話になる」の合図なので、
 * 線だけを引かず必ず見出しと組で使う。線だけの区切りを画面に足すと、
 * 見た目は整うが読む順番の手がかりにはならない。
 *
 * 見出しは小さく静かに (design-system §3-1)。大きく色を付けて目立たせるのは
 * 中身の数字であって、見出しではない。
 */
export function SectionHeading({
  children,
  /** 見出しの右に置くもの (件数・小さな操作) */
  action,
  /** 見出しの下に出す一言 */
  note,
  /** 上に区切り線を引くか。画面の先頭に置くときは false */
  divider = true,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  note?: ReactNode;
  divider?: boolean;
  className?: string;
}) {
  return (
    <div
      className={[
        divider ? "mt-8 border-t border-line pt-6 first:mt-0 first:border-t-0 first:pt-0" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-bold text-ink">{children}</h2>
        {action ? <div className="text-xs text-ink-muted">{action}</div> : null}
      </div>
      {note ? <p className="prose-note mt-1 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}
