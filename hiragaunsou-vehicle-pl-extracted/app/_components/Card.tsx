import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 白カード。全画面の「面」はこれ1つに揃える。
 *
 * これまでは各画面が `rounded-xl border border-line bg-white p-5` を直接書いていた。
 * 同じ指定をコピーして回ると、角丸や余白が1〜2pxずつずれるだけでなく、
 * 「長い説明文がカードの枠からはみ出る」といった折り返しの不具合を
 * 画面ごとに1枚ずつ直すことになる。器をここ1箇所にして、直しは常にここで行う。
 *
 * はみ出し対策は globals.css の `.card` に持たせている(min-width と折り返し)。
 * 新しい画面で長い日本語を書いてもカードの外へ出ない。
 */
export function Card({
  title,
  action,
  children,
  className = "",
  padding = "normal",
}: {
  /** セクション見出し。無い面(数字だけのタイル等)では省略する */
  title?: ReactNode;
  /** 見出しの右に置く補助操作・件数 */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** tight = 行を敷き詰める一覧用。normal = 通常 */
  padding?: "normal" | "tight";
}) {
  return (
    <section className={`card ${padding === "tight" ? "p-0" : "p-5"} ${className}`.trim()}>
      {(title || action) && (
        <div
          className={`flex flex-wrap items-baseline justify-between gap-2 ${
            padding === "tight" ? "border-b border-line px-4 py-3" : "mb-3"
          }`}
        >
          {title ? <h2 className="text-sm font-bold text-ink">{title}</h2> : <span />}
          {action}
        </div>
      )}
      {padding === "tight" ? <div className="px-4 py-3">{children}</div> : children}
    </section>
  );
}

/**
 * 画面名と説明を2行で読ませる画面遷移カード。
 *
 * `.btn` は1行の操作専用で、中身を横一列にして折り返さない。
 * 呼び名と説明を持つ導線はこの部品に集約し、画面ごとに枠を書き起さない。
 */
export function ScreenLinkCard({
  href,
  label,
  description,
}: {
  href: string;
  label: ReactNode;
  description: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="pressable block whitespace-normal break-words rounded-[var(--radius-control)] border border-line bg-white px-4 py-2 hover:bg-subtle"
    >
      <span className="block text-sm font-semibold text-ink">{label}</span>
      <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>
    </Link>
  );
}

/**
 * 長い説明文の器。
 *
 * 「どのファイルを選べばよいですか?」のような数行の日本語は、
 * 置く場所によって折り返しの効き方が変わり、枠の外へ流れることがあった。
 * 説明文は必ずこの器に入れる。折り返しの指定は globals.css の `.prose-note` 1箇所だけが持つ。
 */
export function Prose({
  children,
  className = "",
  tone = "muted",
}: {
  children: ReactNode;
  className?: string;
  /** muted = 補足の灰文字 / normal = 本文と同じ濃さ */
  tone?: "muted" | "normal";
}) {
  return (
    <div
      className={`prose-note text-xs leading-relaxed ${
        tone === "muted" ? "text-ink-muted" : "text-ink"
      } ${className}`.trim()}
    >
      {children}
    </div>
  );
}
